import { createHash } from 'node:crypto';

import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import { SCAMSHIELD_ACTIONS } from './scamshield.constants';
import { ScamShieldAnalysisModel, type ScamShieldAnalysisDocument } from './scamshield.model';
import type {
  AnalyzeEmailInput,
  AnalyzeScreenshotInput,
  AnalyzeTextInput,
  CheckUrlInput,
  GenerateReportDraftInput,
  RedactScamContentInput,
  SubmitScamReportInput
} from './scamshield.schema';
import type {
  ScamShieldAnalysisType,
  ScamShieldOwner,
  ScamShieldServiceContext
} from './scamshield.types';

type HydratedScamShieldAnalysisDocument = HydratedDocument<ScamShieldAnalysisDocument>;

const ownerFilter = (owner: ScamShieldOwner): ScamShieldOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const assertAiConsent = async (owner: ScamShieldOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai consent is required for ScamShield analysis'
    );
  }
};

const assertShareConsent = async (
  owner: ScamShieldOwner,
  consentToShare: boolean
): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (consentToShare && !consent.share_with_agencies) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'share_with_agencies consent is required to submit externally'
    );
  }
};

const audit = async (
  context: ScamShieldServiceContext,
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

const scoreContent = (content: string): { riskScore: number; indicators: string[] } => {
  const patterns = [
    ['urgent pressure', /\burgent\b|\bact now\b|\bimmediately\b/i],
    ['credential request', /\bpassword\b|\blogin\b|\bverify your account\b/i],
    ['payment request', /\bgift card\b|\bwire transfer\b|\bcrypto\b|\bbitcoin\b|\bpayment\b/i],
    ['suspicious link', /https?:\/\/[^\s]+|bit\.ly|tinyurl|t\.co/i],
    ['threat or penalty', /\bsuspended\b|\bblocked\b|\bfine\b|\barrest\b|\bpenalty\b/i],
    ['prize or refund lure', /\bprize\b|\bwinner\b|\brefund\b|\bcompensation\b/i]
  ] as const;
  const indicators = patterns
    .filter(([, pattern]) => pattern.test(content))
    .map(([label]) => label);
  const riskScore = Math.min(100, indicators.length * 18 + (content.length > 2000 ? 8 : 0));

  return { riskScore, indicators };
};

const riskLevelForScore = (score: number): ScamShieldAnalysisDocument['riskLevel'] => {
  if (score >= 75) {
    return 'critical';
  }

  if (score >= 50) {
    return 'high';
  }

  if (score >= 25) {
    return 'medium';
  }

  return 'low';
};

const createAnalysis = async (
  context: ScamShieldServiceContext,
  type: ScamShieldAnalysisType,
  content: string,
  input: Record<string, unknown>,
  action: string
): Promise<ScamShieldAnalysisDocument> => {
  await assertAiConsent(context.owner);
  const scored = scoreContent(content);
  const analysis = await ScamShieldAnalysisModel.create({
    ...ownerFilter(context.owner),
    reportId: input.reportId,
    type,
    inputHash: hashValue(input),
    riskLevel: riskLevelForScore(scored.riskScore),
    riskScore: scored.riskScore,
    indicators: scored.indicators,
    metadata: {
      ...((input.metadata as Record<string, unknown> | undefined) ?? {}),
      informationOnly: true,
      humanReviewRequired: true
    }
  });

  await audit(context, action, analysis._id.toString(), {
    type,
    riskLevel: analysis.riskLevel,
    riskScore: analysis.riskScore
  });

  return analysis;
};

const getOwnedAnalysis = async (
  owner: ScamShieldOwner,
  analysisId: string
): Promise<HydratedScamShieldAnalysisDocument> => {
  const analysis = await ScamShieldAnalysisModel.findOne({
    _id: analysisId,
    ...ownerFilter(owner)
  });

  if (!analysis) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'ScamShield analysis not found');
  }

  return analysis;
};

export const analyzeText = async (context: ScamShieldServiceContext, input: AnalyzeTextInput) =>
  createAnalysis(context, 'text', input.text, input, SCAMSHIELD_ACTIONS.analyzeText);

export const analyzeEmail = async (context: ScamShieldServiceContext, input: AnalyzeEmailInput) =>
  createAnalysis(
    context,
    'email',
    `${input.subject ?? ''}\n${input.from ?? ''}\n${input.body}`,
    input,
    SCAMSHIELD_ACTIONS.analyzeEmail
  );

export const analyzeScreenshot = async (
  context: ScamShieldServiceContext,
  input: AnalyzeScreenshotInput
) =>
  createAnalysis(
    context,
    'screenshot',
    input.imageText,
    input,
    SCAMSHIELD_ACTIONS.analyzeScreenshot
  );

export const checkUrl = async (context: ScamShieldServiceContext, input: CheckUrlInput) =>
  createAnalysis(context, 'url', input.url, input, SCAMSHIELD_ACTIONS.checkUrl);

export const getAnalysisById = async (context: ScamShieldServiceContext, analysisId: string) => {
  const analysis = await getOwnedAnalysis(context.owner, analysisId);
  await audit(context, SCAMSHIELD_ACTIONS.get, analysis._id.toString());

  return analysis;
};

export const redactScamContent = async (
  context: ScamShieldServiceContext,
  input: RedactScamContentInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const redacted = input.text
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      input.replacement === 'mask' ? '***' : '[EMAIL]'
    )
    .replace(/\+?\d[\d\s().-]{7,}\d/g, input.replacement === 'mask' ? '***' : '[PHONE]')
    .replace(/https?:\/\/[^\s]+/gi, input.replacement === 'mask' ? '***' : '[URL]');

  await audit(context, SCAMSHIELD_ACTIONS.redact, undefined, {
    inputHash: hashValue(input.text)
  });

  return {
    redactedText: redacted,
    informationOnly: true
  };
};

export const generateReportDraft = async (
  context: ScamShieldServiceContext,
  input: GenerateReportDraftInput
): Promise<ScamShieldAnalysisDocument> => {
  const analysis = await getOwnedAnalysis(context.owner, input.analysisId);
  analysis.draftReport = {
    source: 'scamshield',
    riskLevel: analysis.riskLevel,
    riskScore: analysis.riskScore,
    indicators: analysis.indicators,
    notes: input.notes,
    informationOnly: true,
    humanReviewRequired: true
  };
  await analysis.save();
  await audit(context, SCAMSHIELD_ACTIONS.generateReportDraft, analysis._id.toString());

  return analysis;
};

export const submitScamReport = async (
  context: ScamShieldServiceContext,
  input: SubmitScamReportInput
): Promise<ScamShieldAnalysisDocument> => {
  await assertShareConsent(context.owner, input.consentToShare);
  const analysis = await getOwnedAnalysis(context.owner, input.analysisId);
  analysis.status = 'submitted';
  analysis.submittedAt = new Date();
  analysis.metadata = {
    ...analysis.metadata,
    submissionDestination: input.destination,
    consentToShare: input.consentToShare
  };
  await analysis.save();
  await audit(context, SCAMSHIELD_ACTIONS.submit, analysis._id.toString(), {
    destination: input.destination,
    consentToShare: input.consentToShare
  });

  return analysis;
};
