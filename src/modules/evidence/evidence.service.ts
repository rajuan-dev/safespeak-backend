import { StatusCodes } from 'http-status-codes';
import type { Types } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { generateSecureToken, hashBuffer, signPayload } from '@common/utils/crypto';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';
import { ReportModel } from '@modules/reports/reports.model';
import {
  assertSupportedTranscriptionMimeType,
  transcribeAudioBuffer
} from '@modules/ai/ai-transcription.service';

import { EVIDENCE_ACTIONS } from './evidence.constants';
import { EvidenceAuditChainModel } from './evidence-audit.model';
import { EvidenceModel, type EvidenceDocument } from './evidence.model';
import type {
  CompleteUploadInput,
  CreateUploadUrlInput,
  TranscribeEvidenceInput,
  VerifyHashInput
} from './evidence.schema';
import {
  createS3UploadUrl,
  hasS3Storage,
  readDecryptedLocalFile,
  removeLocalFileIfExists,
  storeEncryptedLocalFile,
  syncEvidenceToS3
} from './evidence.storage';
import type { EvidenceOwner, EvidenceUploadFile } from './evidence.types';

const ownerFilter = (owner: EvidenceOwner): EvidenceOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const actorForOwner = (owner: EvidenceOwner) => ({
  actorType: owner.userId ? ('user' as const) : ('anonymous_session' as const),
  actorId: owner.userId,
  sessionId: owner.sessionId
});

const normalizeForSignature = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeForSignature);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, normalizeForSignature(nestedValue)])
    );
  }

  return value;
};

const serializeAuditPayload = (payload: Record<string, unknown>): string =>
  JSON.stringify(normalizeForSignature(payload));

const toSafeEvidence = (evidence: EvidenceDocument): Record<string, unknown> => {
  return {
    id: evidence._id,
    reportId: evidence.reportId,
    userId: evidence.userId,
    sessionId: evidence.sessionId,
    ownerType: evidence.ownerType,
    type: evidence.type,
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    size: evidence.size,
    storageKey: evidence.storageKey,
    storageRegion: evidence.storageRegion,
    sha256Hash: evidence.sha256Hash,
    encryptionKeyRef: evidence.encryptionKeyRef,
    metadata: evidence.metadata,
    consentSnapshot: evidence.consentSnapshot,
    status: evidence.status,
    storageProvider: evidence.storageProvider,
    s3: evidence.s3,
    deletionRequestedAt: evidence.deletionRequestedAt,
    deletedAt: evidence.deletedAt,
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt
  };
};

const appendEvidenceAudit = async (
  owner: EvidenceOwner,
  evidence: EvidenceDocument,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  const latest = await EvidenceAuditChainModel.findOne({ evidenceId: evidence._id }).sort({
    sequence: -1
  });
  const sequence = (latest?.sequence ?? 0) + 1;
  const payload = serializeAuditPayload({
    action,
    evidenceId: evidence._id.toString(),
    reportId: evidence.reportId.toString(),
    sequence,
    previousHash: latest?.eventHash,
    metadata
  });
  const eventHash = hashBuffer(Buffer.from(payload));
  const signature = signPayload(eventHash);

  await EvidenceAuditChainModel.create({
    evidenceId: evidence._id,
    reportId: evidence.reportId,
    ...actorForOwner(owner),
    action,
    sequence,
    previousHash: latest?.eventHash,
    eventHash,
    signature,
    metadata
  });
};

const auditEvidenceChange = async (
  owner: EvidenceOwner,
  action: string,
  evidenceId: Types.ObjectId | string,
  ip?: string,
  userAgent?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    ...actorForOwner(owner),
    action,
    resourceType: 'evidence',
    resourceId: evidenceId,
    ip,
    userAgent,
    metadata
  });
};

const assertOwnedReport = async (owner: EvidenceOwner, reportId: string) => {
  const report = await ReportModel.findOne({
    _id: reportId,
    ...ownerFilter(owner),
    deletedAt: {
      $exists: false
    }
  });

  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found');
  }

  if (report.status === 'deleted' || report.status === 'withdrawn') {
    throw new ApiError(StatusCodes.CONFLICT, 'Evidence cannot be linked to this report');
  }

  return report;
};

const getOwnedEvidence = async (owner: EvidenceOwner, evidenceId: string) => {
  const evidence = await EvidenceModel.findOne({
    _id: evidenceId,
    ...ownerFilter(owner),
    deletedAt: {
      $exists: false
    }
  });

  if (!evidence) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Evidence not found');
  }

  return evidence;
};

const assertTranscriptionConsent = async (owner: EvidenceOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai && !consent.transcribe_audio) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai or transcribe_audio consent is required for transcription'
    );
  }
};

const assertAudioVideoEvidence = (evidence: EvidenceDocument): void => {
  if (!evidence.mimeType.startsWith('audio/') && !evidence.mimeType.startsWith('video/')) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Only audio or video evidence can be transcribed'
    );
  }

  assertSupportedTranscriptionMimeType(evidence.mimeType);
};

const buildStorageKey = (reportId: string, fileName: string): string =>
  [
    env.EVIDENCE_S3_PREFIX,
    env.AWS_REGION,
    reportId,
    `${generateSecureToken(18)}-${fileName.replace(/[^\w.-]/g, '_').slice(0, 120)}`
  ].join('/');

export const createEvidenceUploadUrl = async (
  owner: EvidenceOwner,
  input: CreateUploadUrlInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  await assertOwnedReport(owner, input.reportId);
  const consentSnapshot = await getCurrentConsent(owner);

  if (!consentSnapshot.cloud_sync) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cloud sync consent is required for evidence upload');
  }

  const storageKey = buildStorageKey(input.reportId, input.fileName);
  const evidence = await EvidenceModel.create({
    ...ownerFilter(owner),
    reportId: input.reportId,
    ownerType: owner.userId ? 'user' : 'anonymous',
    type: input.type,
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.size,
    storageKey,
    storageRegion: env.AWS_REGION,
    encryptionKeyRef: 'evidence:v1',
    metadata: input.metadata ?? {},
    status: 'pending_upload',
    storageProvider: 'local_encrypted',
    encryption: {
      algorithm: 'aes-256-gcm'
    },
    consentSnapshot
  });
  const uploadUrl = await createS3UploadUrl(storageKey, input.mimeType);

  await appendEvidenceAudit(owner, evidence, EVIDENCE_ACTIONS.uploadUrlCreate, {
    storageKey,
    s3Configured: hasS3Storage()
  });
  await auditEvidenceChange(owner, EVIDENCE_ACTIONS.uploadUrlCreate, evidence._id, ip, userAgent, {
    reportId: input.reportId,
    storageKey
  });

  return {
    evidence: toSafeEvidence(evidence),
    upload: {
      method: uploadUrl ? 'PUT' : 'POST',
      uploadUrl: uploadUrl ?? '/api/v1/evidence/complete-upload',
      expiresInSeconds: uploadUrl ? 900 : undefined,
      storageKey,
      mode: uploadUrl ? 's3_presigned' : 'server_multipart'
    }
  };
};

export const completeEvidenceUpload = async (
  owner: EvidenceOwner,
  input: CompleteUploadInput,
  file: EvidenceUploadFile | undefined,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Evidence file is required to verify upload hash');
  }

  const evidence = await getOwnedEvidence(owner, input.evidenceId);

  if (evidence.status !== 'pending_upload') {
    throw new ApiError(StatusCodes.CONFLICT, 'Evidence upload has already been completed');
  }

  if (file.size !== evidence.size || file.mimetype !== evidence.mimeType) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Uploaded file metadata does not match reservation'
    );
  }

  const sha256Hash = hashBuffer(file.buffer);

  if (sha256Hash !== input.sha256Hash) {
    throw new ApiError(StatusCodes.CONFLICT, 'Provided SHA-256 hash does not match uploaded file');
  }

  const encryptedFile = await storeEncryptedLocalFile(evidence.reportId.toString(), file.buffer);
  evidence.localEncryptedPath = encryptedFile.path;
  evidence.encryption.iv = encryptedFile.iv;
  evidence.encryption.authTag = encryptedFile.authTag;
  evidence.sha256Hash = sha256Hash;
  evidence.metadata = {
    ...evidence.metadata,
    ...(input.metadata ?? {})
  };

  if (hasS3Storage()) {
    evidence.s3 = await syncEvidenceToS3(evidence);
    evidence.storageProvider = 's3';
    evidence.status = 'synced';
  } else {
    evidence.status = 'local_only';
  }

  await evidence.save();
  await appendEvidenceAudit(owner, evidence, EVIDENCE_ACTIONS.completeUpload, {
    sha256Hash,
    storageProvider: evidence.storageProvider,
    status: evidence.status
  });
  await auditEvidenceChange(owner, EVIDENCE_ACTIONS.completeUpload, evidence._id, ip, userAgent, {
    reportId: evidence.reportId,
    sha256Hash,
    status: evidence.status
  });

  return toSafeEvidence(evidence);
};

export const getEvidenceById = async (owner: EvidenceOwner, evidenceId: string): Promise<unknown> =>
  getOwnedEvidence(owner, evidenceId).then(toSafeEvidence);

export const getEvidenceMetadata = async (
  owner: EvidenceOwner,
  evidenceId: string
): Promise<unknown> => {
  const evidence = await getOwnedEvidence(owner, evidenceId);

  return {
    id: evidence._id,
    reportId: evidence.reportId,
    type: evidence.type,
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    size: evidence.size,
    storageKey: evidence.storageKey,
    storageRegion: evidence.storageRegion,
    sha256Hash: evidence.sha256Hash,
    encryptionKeyRef: evidence.encryptionKeyRef,
    metadata: evidence.metadata,
    consentSnapshot: evidence.consentSnapshot,
    status: evidence.status,
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt,
    deletionRequestedAt: evidence.deletionRequestedAt
  };
};

export const verifyEvidenceHash = async (
  owner: EvidenceOwner,
  evidenceId: string,
  input: VerifyHashInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const evidence = await getOwnedEvidence(owner, evidenceId);

  if (!evidence.sha256Hash) {
    throw new ApiError(StatusCodes.CONFLICT, 'Evidence upload is not complete');
  }

  const localBuffer = await readDecryptedLocalFile(evidence);
  const computedSha256Hash = hashBuffer(localBuffer);
  const verified =
    computedSha256Hash === evidence.sha256Hash && computedSha256Hash === input.sha256Hash;

  await appendEvidenceAudit(owner, evidence, EVIDENCE_ACTIONS.verifyHash, {
    verified,
    providedSha256Hash: input.sha256Hash,
    computedSha256Hash
  });
  await auditEvidenceChange(owner, EVIDENCE_ACTIONS.verifyHash, evidence._id, ip, userAgent, {
    reportId: evidence.reportId,
    verified
  });

  return {
    verified,
    expectedSha256Hash: evidence.sha256Hash,
    providedSha256Hash: input.sha256Hash,
    computedSha256Hash
  };
};

export const softDeleteEvidence = async (
  owner: EvidenceOwner,
  evidenceId: string,
  ip?: string,
  userAgent?: string
): Promise<void> => {
  const evidence = await getOwnedEvidence(owner, evidenceId);
  evidence.deletionRequestedAt = evidence.deletionRequestedAt ?? new Date();
  evidence.deletedAt = new Date();
  evidence.status = 'deleted';
  await evidence.save();

  if (evidence.localEncryptedPath) {
    await removeLocalFileIfExists(evidence.localEncryptedPath);
  }

  await appendEvidenceAudit(owner, evidence, EVIDENCE_ACTIONS.softDelete, {
    deletionRequestedAt: evidence.deletionRequestedAt,
    localEncryptedFileRemoved: Boolean(evidence.localEncryptedPath)
  });
  await auditEvidenceChange(owner, EVIDENCE_ACTIONS.softDelete, evidence._id, ip, userAgent, {
    reportId: evidence.reportId
  });
};

export const getEvidenceAuditChain = async (
  owner: EvidenceOwner,
  evidenceId: string
): Promise<unknown[]> => {
  const evidence = await getOwnedEvidence(owner, evidenceId);

  return EvidenceAuditChainModel.find({ evidenceId: evidence._id }).sort({ sequence: 1 }).lean();
};

export const transcribeEvidenceById = async (
  owner: EvidenceOwner,
  evidenceId: string,
  input: TranscribeEvidenceInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  await assertTranscriptionConsent(owner);
  const evidence = await getOwnedEvidence(owner, evidenceId);
  assertAudioVideoEvidence(evidence);

  const fileBuffer = await readDecryptedLocalFile(evidence);
  const result = await transcribeAudioBuffer({
    buffer: fileBuffer,
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    language: input.language
  });

  if (input.saveTranscript) {
    evidence.transcription = {
      text: result.transcript,
      language: result.language,
      model: result.model,
      provider: result.provider,
      transcribedAt: new Date(),
      transcribedBy: owner.userId ?? owner.sessionId
    };
    await evidence.save();
  }

  if (input.reportId) {
    const report = await assertOwnedReport(owner, input.reportId);
    const nextFields = {
      ...report.structuredFields,
      evidenceItems: [
        ...((report.structuredFields?.evidenceItems as unknown[]) ?? []),
        {
          evidenceId: evidence._id.toString(),
          transcriptionAvailable: input.saveTranscript,
          transcribedAt: new Date().toISOString()
        }
      ]
    };
    report.structuredFields = nextFields;

    if (input.useAsNarrative) {
      if (!(report.consentSnapshot as { cloud_sync?: boolean })?.cloud_sync) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          'cloud_sync consent is required to store transcription as report narrative'
        );
      }

      report.originalNarrative = result.transcript;
    }

    await report.save();
  }

  await appendEvidenceAudit(owner, evidence, EVIDENCE_ACTIONS.transcribed, {
    reportId: input.reportId,
    saved: input.saveTranscript
  });
  await auditEvidenceChange(owner, EVIDENCE_ACTIONS.transcribed, evidence._id, ip, userAgent, {
    reportId: evidence.reportId,
    saved: input.saveTranscript
  });
  await createAuditLog({
    ...actorForOwner(owner),
    action: 'evidence.transcription_created',
    resourceType: 'evidence',
    resourceId: evidence._id,
    ip,
    userAgent,
    metadata: {
      reportId: evidence.reportId,
      model: result.model,
      provider: result.provider
    }
  });

  return {
    transcript: result.transcript,
    language: result.language,
    model: result.model,
    reportId: input.reportId,
    evidenceId: evidence._id.toString(),
    saved: input.saveTranscript
  };
};

export const getEvidenceTranscription = async (
  owner: EvidenceOwner,
  evidenceId: string,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const evidence = await getOwnedEvidence(owner, evidenceId);

  if (!evidence.transcription?.text) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'No transcription found for this evidence');
  }

  await createAuditLog({
    ...actorForOwner(owner),
    action: EVIDENCE_ACTIONS.transcriptionViewed,
    resourceType: 'evidence',
    resourceId: evidence._id,
    ip,
    userAgent
  });

  return {
    evidenceId: evidence._id.toString(),
    reportId: evidence.reportId.toString(),
    transcription: {
      text: evidence.transcription.text,
      language: evidence.transcription.language,
      model: evidence.transcription.model,
      provider: evidence.transcription.provider,
      transcribedAt: evidence.transcription.transcribedAt
    }
  };
};

export const saveTranscriptionToEvidence = async (
  owner: EvidenceOwner,
  evidenceId: string,
  transcript: {
    text: string;
    language?: string;
    model?: string;
    provider?: string;
  }
): Promise<void> => {
  const evidence = await getOwnedEvidence(owner, evidenceId);
  evidence.transcription = {
    text: transcript.text,
    language: transcript.language,
    model: transcript.model,
    provider: transcript.provider,
    transcribedAt: new Date(),
    transcribedBy: owner.userId ?? owner.sessionId
  };
  await evidence.save();
};

export const assertOwnerCanTranscribe = async (owner: EvidenceOwner): Promise<void> => {
  await assertTranscriptionConsent(owner);
};
