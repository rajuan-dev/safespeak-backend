import { StatusCodes } from 'http-status-codes';
import { Error as MongooseError } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';
import { UserProfileModel } from '@modules/profile/profile.model';
import { AnonymousSessionModel } from '@modules/sessions/sessions.model';

import { WITHDRAW_BLOCKED_STATUSES } from './reports.constants';
import { ReportModel } from './reports.model';
import type { ReportDocument } from './reports.model';
import type { CreateReportInput, UpdateReportInput } from './reports.schema';
import type { ReportOwner, ReportStatus } from './reports.types';

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

const applyConsentStorageRules = (
  input: CreateReportInput | UpdateReportInput,
  hasCloudSyncConsent: boolean
): Partial<CreateReportInput | UpdateReportInput> => {
  if (hasCloudSyncConsent) {
    return input;
  }

  return {
    language: input.language,
    jurisdiction: input.jurisdiction,
    lga: input.lga,
    status: 'local_only',
    structuredFields: {}
  };
};

const applyUpdateConsentStorageRules = (
  input: UpdateReportInput,
  hasCloudSyncConsent: boolean
): Partial<UpdateReportInput> => {
  if (hasCloudSyncConsent) {
    return input;
  }

  const storedInput: Partial<UpdateReportInput> = {
    structuredFields: {}
  };

  if (input.language !== undefined) {
    storedInput.language = input.language;
  }

  if (input.jurisdiction !== undefined) {
    storedInput.jurisdiction = input.jurisdiction;
  }

  if (input.lga !== undefined) {
    storedInput.lga = input.lga;
  }

  if (input.status !== undefined) {
    storedInput.status = input.status;
  }

  return storedInput;
};

export const createReport = async (
  owner: ReportOwner,
  input: CreateReportInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const filter = ownerFilter(owner);
  const consentSnapshot = await getCurrentConsent(owner);
  const hasCloudSyncConsent = consentSnapshot.cloud_sync;
  const storedInput = applyConsentStorageRules(input, hasCloudSyncConsent);
  const status = hasCloudSyncConsent ? (input.status ?? 'draft') : 'local_only';
  const report = await ReportModel.create({
    ...filter,
    ...storedInput,
    refNo: generateRefNo(),
    ownerType: owner.userId ? 'user' : 'anonymous',
    consentSnapshot,
    status,
    statusHistory: createStatusHistory(status, hasCloudSyncConsent ? 'created' : 'local_only')
  });

  await auditReportChange(owner, 'report.create', report._id.toString(), ip, userAgent, {
    status,
    cloudSyncConsent: hasCloudSyncConsent
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
  const storedInput = applyUpdateConsentStorageRules(input, consentSnapshot.cloud_sync);

  report.set(storedInput);
  await normalizeReportRequiredFields(report, owner, input);

  if (input.status) {
    report.statusHistory.push(
      ...createStatusHistory(
        input.status,
        consentSnapshot.cloud_sync ? undefined : 'cloud_sync_not_granted'
      )
    );
  } else if (!consentSnapshot.cloud_sync) {
    report.statusHistory.push(...createStatusHistory(report.status, 'cloud_sync_not_granted'));
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
    status: report.status,
    deletionRequestedAt: report.deletionRequestedAt,
    withdrawnAt: report.withdrawnAt
  };
};

export const getReportTimeline = async (owner: ReportOwner, reportId: string): Promise<unknown> => {
  const report = await getOwnedReport(owner, reportId);

  return report.statusHistory;
};
