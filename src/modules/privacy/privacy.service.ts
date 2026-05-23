import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { UserModel } from '@modules/auth/auth.model';
import { AiInteractionModel } from '@modules/ai/ai.model';
import { ConsentRecordModel } from '@modules/consent/consent.model';
import {
  ConversationFlowFactsModel,
  ConversationFlowMessageModel,
  ConversationFlowSessionModel,
  ConversationFlowTriageModel
} from '@modules/conversation-flow/conversation-flow.model';
import { EvidenceAuditChainModel } from '@modules/evidence/evidence-audit.model';
import { EvidenceModel } from '@modules/evidence/evidence.model';
import { UserProfileModel } from '@modules/profile/profile.model';
import { ReportModel, ReportSubmissionModel } from '@modules/reports/reports.model';
import { AnonymousSessionModel } from '@modules/sessions/sessions.model';
import { ScamShieldAnalysisModel } from '@modules/scamshield/scamshield.model';
import {
  AdvocateRequestModel,
  HelpSupportRequestModel,
  SafetyPlanModel,
  WarmReferralModel
} from '@modules/support/support.model';
import { PrivacyRequestModel } from '@modules/admin/admin.model';

import type { CreatePrivacyRequestInput, DeleteRequestInput } from './privacy.schema';
import type { PrivacyOwner, PrivacyServiceContext } from './privacy.types';

const ownerFilter = (owner: PrivacyOwner): PrivacyOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const audit = async (
  context: PrivacyServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

const stripEvidenceStorageSecrets = (evidence: Record<string, unknown>) => {
  const {
    encryptionKeyRef: _encryptionKeyRef,
    localEncryptedPath: _localEncryptedPath,
    storageKey: _storageKey,
    s3: _s3,
    encryption: _encryption,
    ...safeEvidence
  } = evidence;

  return {
    ...safeEvidence,
    fileContentIncluded: false,
    storageSecretsIncluded: false
  };
};

export const createPrivacyRequest = async (
  context: PrivacyServiceContext,
  input: CreatePrivacyRequestInput
): Promise<unknown> => {
  if (!input.confirmation) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Privacy request confirmation is required');
  }

  const filter = ownerFilter(context.owner);
  const request = await PrivacyRequestModel.create({
    ...filter,
    requestType: input.requestType,
    notes: input.notes,
    status: 'pending'
  });

  await audit(context, 'privacy.request.create', request._id.toString(), {
    requestType: input.requestType
  });

  return request;
};

export const listOwnPrivacyRequests = async (
  context: PrivacyServiceContext
): Promise<unknown[]> => {
  const requests = await PrivacyRequestModel.find(ownerFilter(context.owner))
    .sort({ createdAt: -1 })
    .lean();

  await audit(context, 'privacy.request.list', undefined, { count: requests.length });

  return requests;
};

export const getOwnPrivacyRequest = async (
  context: PrivacyServiceContext,
  id: string
): Promise<unknown> => {
  const request = await PrivacyRequestModel.findOne({
    _id: id,
    ...ownerFilter(context.owner)
  }).lean();

  if (!request) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Privacy request not found');
  }

  await audit(context, 'privacy.request.get', id);

  return request;
};

export const createDeletionRequest = async (
  context: PrivacyServiceContext,
  input: DeleteRequestInput
): Promise<unknown> =>
  createPrivacyRequest(context, {
    requestType: 'data_deletion',
    notes: input.notes,
    confirmation: input.confirmation
  });

export const getPrivacyExport = async (
  context: PrivacyServiceContext
): Promise<Record<string, unknown>> => {
  const filter = ownerFilter(context.owner);
  const profileFilter = filter;
  const conversationSessions = await ConversationFlowSessionModel.find(filter)
    .sort({ createdAt: -1 })
    .lean();
  const conversationSessionIds = conversationSessions.map((session) => session._id);

  const [
    user,
    anonymousSession,
    profile,
    consentHistory,
    reports,
    reportSubmissions,
    evidence,
    evidenceAuditChain,
    aiInteractions,
    conversationMessages,
    conversationFacts,
    conversationTriage,
    scamShieldAnalyses,
    warmReferrals,
    advocateRequests,
    helpSupportRequests,
    safetyPlans,
    privacyRequests
  ] = await Promise.all([
    filter.userId
      ? UserModel.findById(filter.userId)
          .select(
            'email fullName contactNo avatarUrl role status isEmailVerified lastLoginAt createdAt updatedAt'
          )
          .lean()
      : null,
    filter.sessionId
      ? AnonymousSessionModel.findById(filter.sessionId)
          .select('isAnonymous language jurisdiction lga safetyGateAcceptedAt expiresAt createdAt updatedAt')
          .lean()
      : null,
    UserProfileModel.findOne(profileFilter).lean(),
    ConsentRecordModel.find(filter).sort({ version: -1 }).lean(),
    ReportModel.find(filter).sort({ createdAt: -1 }).lean(),
    ReportSubmissionModel.find(filter).sort({ createdAt: -1 }).lean(),
    EvidenceModel.find(filter).sort({ createdAt: -1 }).lean(),
    EvidenceAuditChainModel.find({
      ...(filter.userId ? { actorId: filter.userId } : { sessionId: filter.sessionId })
    })
      .sort({ createdAt: -1 })
      .lean(),
    AiInteractionModel.find(filter).sort({ createdAt: -1 }).lean(),
    ConversationFlowMessageModel.find({
      conversationSessionId: { $in: conversationSessionIds }
    })
      .sort({ createdAt: 1 })
      .lean(),
    ConversationFlowFactsModel.find({
      conversationSessionId: { $in: conversationSessionIds }
    }).lean(),
    ConversationFlowTriageModel.find({
      conversationSessionId: { $in: conversationSessionIds }
    }).lean(),
    ScamShieldAnalysisModel.find(filter).sort({ createdAt: -1 }).lean(),
    WarmReferralModel.find(filter).sort({ createdAt: -1 }).lean(),
    AdvocateRequestModel.find(filter).sort({ createdAt: -1 }).lean(),
    HelpSupportRequestModel.find(filter).sort({ createdAt: -1 }).lean(),
    SafetyPlanModel.find(filter).sort({ createdAt: -1 }).lean(),
    PrivacyRequestModel.find(filter).sort({ createdAt: -1 }).lean()
  ]);

  const exportPayload = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    owner: {
      type: filter.userId ? 'user' : 'anonymous_session',
      userId: filter.userId,
      sessionId: filter.sessionId
    },
    user,
    anonymousSession,
    profile,
    consentHistory,
    reports,
    reportSubmissions,
    evidence: evidence.map((item) =>
      stripEvidenceStorageSecrets(item as unknown as Record<string, unknown>)
    ),
    evidenceAuditChain,
    aiInteractions,
    conversationFlow: {
      sessions: conversationSessions,
      messages: conversationMessages,
      facts: conversationFacts,
      triage: conversationTriage
    },
    scamShieldAnalyses,
    support: {
      warmReferrals,
      advocateRequests,
      helpSupportRequests,
      safetyPlans
    },
    privacyRequests,
    limitations: {
      evidenceFileBinariesIncluded: false,
      evidenceStorageSecretsIncluded: false,
      adminOnlyDataIncluded: false
    }
  };

  await audit(context, 'privacy.export.download', undefined, {
    reports: reports.length,
    evidence: evidence.length,
    consentVersions: consentHistory.length,
    privacyRequests: privacyRequests.length
  });

  return exportPayload;
};
