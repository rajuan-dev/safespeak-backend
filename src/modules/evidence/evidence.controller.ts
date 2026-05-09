import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import type {
  CompleteUploadInput,
  CreateUploadUrlInput,
  TranscribeEvidenceInput,
  VerifyHashInput
} from './evidence.schema';
import {
  completeEvidenceUpload,
  createEvidenceUploadUrl,
  getEvidenceAuditChain,
  getEvidenceById,
  getEvidenceMetadata,
  getEvidenceTranscription,
  softDeleteEvidence,
  transcribeEvidenceById,
  verifyEvidenceHash
} from './evidence.service';

const getOwner = (req: Request) => ({
  userId: req.user?.id,
  sessionId: req.session?.id
});

export const createUploadUrlController = asyncHandler(async (req: Request, res: Response) => {
  const result = await createEvidenceUploadUrl(
    getOwner(req),
    req.body as CreateUploadUrlInput,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.created(res, 'Evidence upload URL created', result);
});

export const completeUploadController = asyncHandler(async (req: Request, res: Response) => {
  const evidence = await completeEvidenceUpload(
    getOwner(req),
    req.body as CompleteUploadInput,
    req.file,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Evidence upload completed', { evidence });
});

export const getEvidenceController = asyncHandler(async (req: Request, res: Response) => {
  const evidence = await getEvidenceById(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Evidence retrieved', { evidence });
});

export const getEvidenceMetadataController = asyncHandler(async (req: Request, res: Response) => {
  const metadata = await getEvidenceMetadata(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Evidence metadata retrieved', { metadata });
});

export const deleteEvidenceController = asyncHandler(async (req: Request, res: Response) => {
  await softDeleteEvidence(getOwner(req), req.params.id, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Evidence deleted', null);
});

export const verifyHashController = asyncHandler(async (req: Request, res: Response) => {
  const verification = await verifyEvidenceHash(
    getOwner(req),
    req.params.id,
    req.body as VerifyHashInput,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Evidence hash verified', { verification });
});

export const getEvidenceAuditChainController = asyncHandler(async (req: Request, res: Response) => {
  const auditChain = await getEvidenceAuditChain(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Evidence audit chain retrieved', { auditChain });
});

export const transcribeEvidenceController = asyncHandler(async (req: Request, res: Response) => {
  const result = await transcribeEvidenceById(
    getOwner(req),
    req.params.id,
    req.body as TranscribeEvidenceInput,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Evidence transcribed successfully', result);
});

export const getEvidenceTranscriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getEvidenceTranscription(
      getOwner(req),
      req.params.id,
      req.ip,
      req.get('user-agent')
    );

    ApiResponse.success(res, 'Evidence transcription retrieved', result);
  }
);
