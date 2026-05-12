import { StatusCodes } from 'http-status-codes';
import { Error as MongooseError, Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import {
  AdminDestinationModel,
  AdminSubmissionTemplateModel,
  type AdminDestinationDocument,
  type AdminSubmissionTemplateDocument
} from '@modules/admin/admin.model';
import { getCurrentConsent } from '@modules/consent/consent.service';
import { EvidenceModel } from '@modules/evidence/evidence.model';
import { UserProfileModel } from '@modules/profile/profile.model';
import { AnonymousSessionModel } from '@modules/sessions/sessions.model';

import {
  buildSubmissionPayloadFromTemplate,
  executeReportDelivery
} from './reports-delivery.service';
import { WITHDRAW_BLOCKED_STATUSES } from './reports.constants';
import { ReportModel, ReportSubmissionModel } from './reports.model';
import type { ReportDocument, ReportSubmissionDocument } from './reports.model';
import type {
  AcknowledgeSubmissionInput,
  CreateReportInput,
  ReportDestinationPreviewQueryInput,
  SubmitReportInput,
  UpdateReportInput
} from './reports.schema';
import type { ReportDestinationPreview, ReportOwner, ReportStatus } from './reports.types';

const ownerFilter = (owner: ReportOwner): ReportOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const generateRefNo = (): string =>
  `SSR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`;

const createStatusHistory = (status: ReportStatus, reason?: string) => [
  {
    status,
    changedAt: new Date(),
    reason
  }
];

const getValidationErrors = (error: MongooseError.ValidationError): unknown[] =>
  Object.values(error.errors).map((validationError) => ({
    path: validationError.path,
    message: validationError.message,
    kind: validationError.kind
  }));

const toValidationApiError = (error: unknown): ApiError | null => {
  if (error instanceof MongooseError.ValidationError) {
    return new ApiError(
      StatusCodes.BAD_REQUEST,
      'Report validation failed',
      getValidationErrors(error)
    );
  }

  return null;
};

const getOwnerLocaleDefaults = async (
  owner: ReportOwner
): Promise<{ language?: string; jurisdiction?: string }> => {
  const filter = ownerFilter(owner);
  const profile = await UserProfileModel.findOne(filter)
    .select({ preferredLanguage: 1, jurisdiction: 1 })
    .lean();

  if (profile?.preferredLanguage || profile?.jurisdiction) {
    return {
      language: profile.preferredLanguage,
      jurisdiction: profile.jurisdiction
    };
  }

  if (!owner.sessionId) {
    return {};
  }

  const session = await AnonymousSessionModel.findById(owner.sessionId)
    .select({ language: 1, jurisdiction: 1 })
    .lean();

  return {
    language: session?.language,
    jurisdiction: session?.jurisdiction
  };
};

const normalizeReportRequiredFields = async (
  report: HydratedDocument<ReportDocument>,
  owner: ReportOwner,
  input: UpdateReportInput
): Promise<void> => {
  if (report.language && report.jurisdiction) {
    return;
  }

  const ownerDefaults = await getOwnerLocaleDefaults(owner);

  report.language = report.language || input.language || ownerDefaults.language || 'en';
  report.jurisdiction =
    report.jurisdiction || input.jurisdiction || ownerDefaults.jurisdiction || 'NSW';
};

const auditReportChange = async (
  owner: ReportOwner,
  action: string,
  resourceId: string,
  ip?: string,
  userAgent?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: owner.userId ? 'user' : 'anonymous_session',
    actorId: owner.userId,
    sessionId: owner.sessionId,
    action,
    resourceType: 'report',
    resourceId,
    ip,
    userAgent,
    metadata
  });
};

const getOwnedReport = async (owner: ReportOwner, reportId: string) => {
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

  return report;
};

const getOwnedSubmission = async (owner: ReportOwner, reportId: string, submissionId: string) => {
  const submission = await ReportSubmissionModel.findOne({
    _id: submissionId,
    reportId,
    ...ownerFilter(owner),
    deletedAt: {
      $exists: false
    }
  });

  if (!submission) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report submission not found');
  }

  return submission;
};

const normalizeFieldKey = (value: string): string => value.replace(/[\s_-]+/g, '').toLowerCase();

const getReportFieldValue = (
  report: HydratedDocument<ReportDocument>,
  field: string,
  evidenceCount: number
): unknown => {
  const normalizedField = normalizeFieldKey(field);
  const structuredFields = report.structuredFields ?? {};

  switch (normalizedField) {
    case 'refno':
      return report.refNo;
    case 'language':
      return report.language;
    case 'jurisdiction':
      return report.jurisdiction;
    case 'lga':
      return report.lga;
    case 'context':
    case 'title':
      return report.context;
    case 'summary':
    case 'narrative':
    case 'originalnarrative':
      return report.originalNarrative;
    case 'translatednarrative':
      return report.translatedNarrative;
    case 'incidenttype':
      return report.incidentType;
    case 'severity':
      return report.severity;
    case 'evidence':
    case 'evidenceitems':
      return evidenceCount > 0 ? evidenceCount : structuredFields.evidenceItems;
    default:
      return structuredFields[field] ?? structuredFields[normalizedField];
  }
};

const hasMeaningfulFieldValue = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined;
};

const getDestinationMetadata = (
  destination: AdminDestinationDocument
): {
  requiredConsentFlags: string[];
  incidentTypes: string[];
} => {
  const metadata = destination.metadata as {
    requiredConsentFlags?: unknown;
    incidentTypes?: unknown;
  };

  return {
    requiredConsentFlags: Array.isArray(metadata?.requiredConsentFlags)
      ? metadata.requiredConsentFlags.filter((value): value is string => typeof value === 'string')
      : destination.consentRequired
        ? ['share_with_agencies']
        : [],
    incidentTypes: Array.isArray(metadata?.incidentTypes)
      ? metadata.incidentTypes.filter((value): value is string => typeof value === 'string')
      : []
  };
};

const toSafeSubmission = <
  T extends Pick<ReportSubmissionDocument, '_id' | 'reportId' | 'destinationId'>
>(
  submission: T
): Record<string, unknown> => ({
  ...(submission as object),
  _id: submission._id.toString(),
  reportId: submission.reportId.toString(),
  destinationId: submission.destinationId.toString()
});

const buildDestinationPreview = async (
  report: HydratedDocument<ReportDocument>,
  destination: AdminDestinationDocument
): Promise<ReportDestinationPreview> => {
  const evidence = await EvidenceModel.find({
    reportId: report._id,
    deletedAt: { $exists: false }
  })
    .select({
      _id: 1,
      type: 1,
      fileName: 1,
      sha256Hash: 1,
      status: 1,
      mimeType: 1,
      createdAt: 1
    })
    .sort({ createdAt: 1 })
    .lean();

  const { requiredConsentFlags, incidentTypes } = getDestinationMetadata(destination);
  const missingRequiredInfo = destination.minimumRequiredInfo.filter(
    (field) => !hasMeaningfulFieldValue(getReportFieldValue(report, field, evidence.length))
  );

  return {
    destinationId: destination._id.toString(),
    destinationKey: destination.key,
    destinationType: destination.type,
    destinationName: destination.name,
    channel: destination.channel,
    jurisdiction: destination.jurisdiction,
    languages: destination.languages,
    endpoint: destination.endpoint,
    contactEmail: destination.contactEmail,
    contactPhone: destination.contactPhone,
    minimumRequiredInfo: destination.minimumRequiredInfo,
    missingRequiredInfo,
    anonymityOptions: destination.anonymityOptions,
    expectedNextSteps: destination.expectedNextSteps,
    consentRequired: destination.consentRequired,
    supportsAcknowledgement: destination.supportsAcknowledgement,
    requiredConsentFlags,
    matchedIncidentTypes: incidentTypes,
    payloadPreview: {
      refNo: report.refNo,
      title: report.context ?? `SafeSpeak report ${report.refNo}`,
      summary: report.originalNarrative ?? report.translatedNarrative ?? '',
      language: report.language,
      jurisdiction: report.jurisdiction,
      incidentType: report.incidentType,
      severity: report.severity,
      structuredFields: report.structuredFields ?? {},
      evidence: evidence.map((item) => ({
        evidenceId: item._id.toString(),
        type: item.type,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sha256Hash: item.sha256Hash,
        status: item.status,
        createdAt: item.createdAt
      }))
    }
  };
};

const getMatchingSubmissionTemplate = async (
  destination: AdminDestinationDocument
): Promise<AdminSubmissionTemplateDocument | null> => {
  const exactTemplate = await AdminSubmissionTemplateModel.findOne({
    destinationType: destination.type,
    channel: destination.channel,
    jurisdiction: destination.jurisdiction,
    isActive: true
  }).sort({ updatedAt: -1 });

  if (exactTemplate) {
    return exactTemplate;
  }

  return AdminSubmissionTemplateModel.findOne({
    destinationType: destination.type,
    channel: destination.channel,
    jurisdiction: { $in: ['ALL', 'AU', 'National'] },
    isActive: true
  }).sort({ updatedAt: -1 });
};

const getCandidateDestinations = async (
  report: HydratedDocument<ReportDocument>,
  query: ReportDestinationPreviewQueryInput
) => {
  const destinations = await AdminDestinationModel.find({
    isActive: true,
    ...(query.destinationType ? { type: query.destinationType } : {}),
    jurisdiction: { $in: [query.jurisdiction ?? report.jurisdiction, 'ALL', 'AU', 'National'] }
  }).sort({ type: 1, name: 1 });

  return destinations.filter((destination) => {
    const metadata = getDestinationMetadata(destination);

    if (!metadata.incidentTypes.length || !report.incidentType) {
      return true;
    }

    return metadata.incidentTypes.includes(report.incidentType);
  });
};

const assertCloudSyncConsentForReportWrite = (hasCloudSyncConsent: boolean): void => {
  if (!hasCloudSyncConsent) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'cloud_sync consent is required before report data can be stored on SafeSpeak servers'
    );
  }
};

export const createReport = async (
  owner: ReportOwner,
  input: CreateReportInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const filter = ownerFilter(owner);
  const consentSnapshot = await getCurrentConsent(owner);
  assertCloudSyncConsentForReportWrite(consentSnapshot.cloud_sync);

  const status = input.status ?? 'draft';
  const report = await ReportModel.create({
    ...filter,
    ...input,
    refNo: generateRefNo(),
    ownerType: owner.userId ? 'user' : 'anonymous',
    consentSnapshot,
    status,
    statusHistory: createStatusHistory(status, 'created')
  });

  await auditReportChange(owner, 'report.create', report._id.toString(), ip, userAgent, {
    status,
    cloudSyncConsent: consentSnapshot.cloud_sync
  });

  return report;
};

export const listReports = async (owner: ReportOwner): Promise<unknown[]> =>
  ReportModel.find({
    ...ownerFilter(owner),
    deletedAt: {
      $exists: false
    }
  })
    .sort({ createdAt: -1 })
    .lean();

export const getReportById = async (owner: ReportOwner, reportId: string): Promise<unknown> =>
  getOwnedReport(owner, reportId);

export const updateReport = async (
  owner: ReportOwner,
  reportId: string,
  input: UpdateReportInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);
  const consentSnapshot = await getCurrentConsent(owner);
  assertCloudSyncConsentForReportWrite(consentSnapshot.cloud_sync);

  report.set(input);
  await normalizeReportRequiredFields(report, owner, input);

  if (input.status) {
    report.statusHistory.push(...createStatusHistory(input.status));
  }

  try {
    await report.save();
  } catch (error) {
    const apiError = toValidationApiError(error);

    if (apiError) {
      throw apiError;
    }

    throw error;
  }
  await auditReportChange(owner, 'report.update', report._id.toString(), ip, userAgent, {
    changedFields: Object.keys(input)
  });

  return report;
};

export const softDeleteReport = async (
  owner: ReportOwner,
  reportId: string,
  ip?: string,
  userAgent?: string
): Promise<void> => {
  const report = await getOwnedReport(owner, reportId);
  report.status = 'deleted';
  report.deletedAt = new Date();
  report.statusHistory.push(...createStatusHistory('deleted', 'soft_delete'));
  await report.save();

  await auditReportChange(owner, 'report.delete', report._id.toString(), ip, userAgent);
};

export const markReportInfoOnly = async (
  owner: ReportOwner,
  reportId: string,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);
  const consentSnapshot = await getCurrentConsent(owner);

  report.status = 'info_only';
  report.statusHistory.push(...createStatusHistory('info_only'));

  if (!consentSnapshot.use_anonymised_analytics) {
    report.originalNarrative = undefined;
    report.translatedNarrative = undefined;
    report.structuredFields = {};
  }

  await report.save();
  await auditReportChange(owner, 'report.mark_info_only', report._id.toString(), ip, userAgent, {
    analyticsConsent: consentSnapshot.use_anonymised_analytics
  });

  return report;
};

export const withdrawReport = async (
  owner: ReportOwner,
  reportId: string,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);

  if (WITHDRAW_BLOCKED_STATUSES.includes(report.status as never)) {
    throw new ApiError(StatusCodes.CONFLICT, 'Report cannot be withdrawn in its current status');
  }

  report.status = 'withdrawn';
  report.withdrawnAt = new Date();
  report.statusHistory.push(...createStatusHistory('withdrawn'));
  await report.save();

  await auditReportChange(owner, 'report.withdraw', report._id.toString(), ip, userAgent);

  return report;
};

export const requestReportDelete = async (
  owner: ReportOwner,
  reportId: string,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);
  report.deletionRequestedAt = new Date();
  report.status = 'deleted';
  report.statusHistory.push(...createStatusHistory('deleted', 'deletion_requested'));
  await report.save();

  await auditReportChange(owner, 'report.request_delete', report._id.toString(), ip, userAgent);

  return report;
};

export const getReportStatus = async (owner: ReportOwner, reportId: string): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);

  return {
    id: report._id,
    refNo: report.refNo,
    current: report.status,
    status: report.status,
    updatedAt: report.updatedAt,
    localOnly: report.status === 'local_only',
    deletionRequestedAt: report.deletionRequestedAt,
    withdrawnAt: report.withdrawnAt
  };
};

export const getReportTimeline = async (owner: ReportOwner, reportId: string): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);

  return report.statusHistory;
};

export const getReportDestinationPreviews = async (
  owner: ReportOwner,
  reportId: string,
  query: ReportDestinationPreviewQueryInput
): Promise<ReportDestinationPreview[]> => {
  const report = await getOwnedReport(owner, reportId);
  const destinations = await getCandidateDestinations(report, query);

  return Promise.all(
    destinations.map((destination) => buildDestinationPreview(report, destination))
  );
};

export const listReportSubmissions = async (
  owner: ReportOwner,
  reportId: string
): Promise<unknown[]> => {
  await getOwnedReport(owner, reportId);

  const submissions = await ReportSubmissionModel.find({
    reportId,
    ...ownerFilter(owner),
    deletedAt: { $exists: false }
  })
    .sort({ createdAt: -1 })
    .lean();

  return submissions.map((submission) => toSafeSubmission(submission));
};

export const submitReportToDestination = async (
  owner: ReportOwner,
  reportId: string,
  input: SubmitReportInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);
  const destination = await AdminDestinationModel.findOne({
    _id: input.destinationId,
    isActive: true
  });

  if (!destination) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Destination not found');
  }

  const preview = await buildDestinationPreview(report, destination);

  if (preview.missingRequiredInfo.length > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Report is missing required information for this destination',
      preview.missingRequiredInfo
    );
  }

  const consentSnapshot = await getCurrentConsent(owner);
  const template = await getMatchingSubmissionTemplate(destination);

  for (const consentFlag of preview.requiredConsentFlags) {
    if (!(consentSnapshot as Record<string, unknown>)[consentFlag]) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        `Consent '${consentFlag}' is required before submission`
      );
    }
  }

  const now = new Date();
  const submissionId = new Types.ObjectId();
  const evidenceSnapshot = preview.payloadPreview.evidence;
  const submissionPayload = buildSubmissionPayloadFromTemplate(template, {
    ...preview.payloadPreview,
    destination: {
      key: preview.destinationKey,
      type: preview.destinationType,
      name: preview.destinationName,
      channel: preview.channel,
      jurisdiction: preview.jurisdiction
    },
    anonymityMode: input.anonymityMode,
    notes: input.notes ?? '',
    consentFlags: preview.requiredConsentFlags
  });
  const deliveryResult = await executeReportDelivery({
    submissionId: submissionId.toString(),
    refNo: report.refNo,
    destination,
    template,
    payload: submissionPayload
  });

  const submission = await ReportSubmissionModel.create({
    _id: submissionId,
    ...ownerFilter(owner),
    reportId: report._id,
    ownerType: owner.userId ? 'user' : 'anonymous',
    destinationId: destination._id,
    templateId: template?._id,
    templateKey: template?.key,
    destinationKey: destination.key,
    destinationType: destination.type,
    destinationName: destination.name,
    channel: destination.channel,
    jurisdiction: destination.jurisdiction,
    languages: destination.languages,
    status: deliveryResult.status,
    anonymityMode: input.anonymityMode,
    minimumRequiredInfo: preview.minimumRequiredInfo,
    missingRequiredInfo: preview.missingRequiredInfo,
    requiredConsentFlags: preview.requiredConsentFlags,
    expectedNextSteps: preview.expectedNextSteps,
    notes: input.notes,
    endpoint: destination.endpoint,
    contactEmail: destination.contactEmail,
    contactPhone: destination.contactPhone,
    payloadSnapshot: submissionPayload,
    evidenceSnapshot,
    consentSnapshot,
    deliveryArtifacts: deliveryResult.deliveryArtifacts ?? [],
    deliveryMessage: deliveryResult.message,
    externalReference: deliveryResult.externalReference,
    acknowledgementPayload: deliveryResult.acknowledgementPayload,
    previewGeneratedAt: now,
    submittedAt: now,
    lastAttemptAt: now
  });

  report.status =
    deliveryResult.status === 'acknowledged'
      ? 'received'
      : deliveryResult.status === 'requires_manual_action'
        ? 'pending_submission'
        : deliveryResult.status === 'failed'
          ? 'ready_for_review'
          : 'submitted';
  report.statusHistory.push(
    ...createStatusHistory(
      report.status,
      `${destination.type}:${destination.channel}:${destination.key}`
    )
  );
  await report.save();

  await auditReportChange(
    owner,
    'report.submit_destination',
    report._id.toString(),
    ip,
    userAgent,
    {
      submissionId: submission._id.toString(),
      destinationId: destination._id.toString(),
      destinationKey: destination.key,
      destinationType: destination.type,
      channel: destination.channel,
      anonymityMode: input.anonymityMode
    }
  );

  return toSafeSubmission(submission.toObject());
};

export const acknowledgeReportSubmission = async (
  owner: ReportOwner,
  reportId: string,
  submissionId: string,
  input: AcknowledgeSubmissionInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);
  const submission = await getOwnedSubmission(owner, reportId, submissionId);

  submission.status = input.status;
  submission.externalReference = input.externalReference;
  submission.acknowledgementMessage = input.acknowledgementMessage;
  submission.acknowledgementPayload = input.acknowledgementPayload;
  submission.acknowledgementReceivedAt = new Date();
  await submission.save();

  if (input.status === 'acknowledged') {
    report.status = 'received';
    report.statusHistory.push(
      ...createStatusHistory('received', `acknowledged:${submission.destinationKey}`)
    );
    await report.save();
  }

  await auditReportChange(
    owner,
    'report.submission_acknowledge',
    report._id.toString(),
    ip,
    userAgent,
    {
      submissionId: submission._id.toString(),
      externalReference: input.externalReference,
      status: input.status
    }
  );

  return toSafeSubmission(submission.toObject());
};
