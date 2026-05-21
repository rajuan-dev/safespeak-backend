import { createHash } from 'node:crypto';

import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';
import { transcribeAudioBuffer } from '@modules/ai/ai-transcription.service';
import { saveTranscriptionToEvidence } from '@modules/evidence/evidence.service';
import type { EvidenceUploadFile } from '@modules/evidence/evidence.types';
import { EvidenceModel } from '@modules/evidence/evidence.model';
import { ReportModel, type ReportDocument } from '@modules/reports/reports.model';
import { getPublicPlatformSettings } from '@modules/platform-settings/platform-settings.service';
import {
  getTaxonomyCatalog,
  type PublicTaxonomyRecord
} from '@modules/taxonomies/taxonomies.service';
import {
  buildInformationOnlyDisclaimer,
  detectClinicalAdviceRisk,
  detectCrisisRisk,
  detectLegalAdviceRisk,
  enforceAiOutputGuardrails,
  getSafeSpeakSystemPrompt,
  shouldRequireHumanReview
} from './ai-guardrails';

import { AI_ACTIONS, DEFAULT_AI_LANGUAGE } from './ai.constants';
import { AiInteractionModel } from './ai.model';
import type {
  ClarifyingQuestionsInput,
  ExtractIncidentFieldsInput,
  GenerateSummaryInput,
  RedactPiiInput,
  TranslateInput,
  TriageReportInput
} from './ai.schema';
import type {
  AiAction,
  AiCitation,
  AiGuardrailResult,
  AiOwner,
  AiServiceContext
} from './ai.types';
import type { TranscribeAudioBodyInput } from './ai.schema';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const ownerFilter = (owner: AiOwner): AiOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const guardrailsForLanguage = (language = DEFAULT_AI_LANGUAGE): AiGuardrailResult => ({
  informationOnly: true,
  requiresHumanReview: true,
  legalAdviceDisclaimer:
    'This output is information-only and must not be treated as prescriptive legal advice.',
  language
});

const assertAiConsent = async (owner: AiOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai consent is required for AI processing'
    );
  }
};

type HydratedReportDocument = HydratedDocument<ReportDocument>;

const getOwnedReport = async (
  owner: AiOwner,
  reportId: string | undefined
): Promise<HydratedReportDocument | null> => {
  if (!reportId) {
    return null;
  }

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

const getReportEvidenceCitations = async (
  owner: AiOwner,
  report: HydratedReportDocument | null
): Promise<AiCitation[]> => {
  if (!report) {
    return [];
  }

  const evidence = await EvidenceModel.find({
    reportId: report._id,
    ...ownerFilter(owner),
    deletedAt: {
      $exists: false
    }
  })
    .select('_id fileName mimeType sha256Hash status')
    .lean();

  return evidence.map((item) => ({
    sourceType: 'evidence',
    sourceId: item._id.toString(),
    title: item.fileName,
    excerpt: `Evidence metadata: ${item.mimeType}, status ${item.status}, sha256 ${item.sha256Hash ?? 'not available'}`
  }));
};

const reportCitation = (report: HydratedReportDocument | null): AiCitation[] =>
  report
    ? [
        {
          sourceType: 'report',
          sourceId: report._id.toString(),
          title: report.refNo,
          excerpt: report.originalNarrative?.slice(0, 400) ?? report.context?.slice(0, 400)
        }
      ]
    : [];

const extractOutputText = (payload: unknown): string => {
  const response = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text)
      .filter(Boolean)
      .join('\n') ?? ''
  );
};

const normalizeJsonCandidate = (text: string): string => {
  const trimmed = text.trim();

  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  return trimmed;
};

export const createEmbedding = async (input: string): Promise<number[]> => {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'OPENAI_API_KEY is not configured');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.OPENAI_EMBEDDING_MODEL,
      input
    })
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI embedding request failed');
  }

  const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = payload.data?.[0]?.embedding;

  if (!embedding) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI embedding response was empty');
  }

  return embedding;
};

const callOpenAIJson = async <TOutput>(
  systemPrompt: string,
  userPrompt: string
): Promise<TOutput> => {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'OPENAI_API_KEY is not configured');
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI response request failed');
  }

  const text = extractOutputText(await response.json());
  const normalizedText = normalizeJsonCandidate(text);

  try {
    return JSON.parse(normalizedText) as TOutput;
  } catch {
    return { text: normalizedText } as TOutput;
  }
};

const systemPrompt = (language: string): string => getSafeSpeakSystemPrompt(language);

const formatTaxonomyPromptList = (records: PublicTaxonomyRecord[]): string =>
  records
    .slice(0, 40)
    .map((record) => `${record.key} (${record.label})`)
    .join('; ');

const recordAiInteraction = async (
  context: AiServiceContext,
  action: AiAction,
  input: unknown,
  output: Record<string, unknown>,
  language: string,
  citations: AiCitation[],
  reportId?: string
): Promise<Record<string, unknown>> => {
  const record = await AiInteractionModel.create({
    ...ownerFilter(context.owner),
    reportId,
    action,
    model: env.OPENAI_MODEL,
    language,
    inputHash: hashValue(input),
    output,
    citations,
    guardrails: guardrailsForLanguage(language),
    reviewStatus: 'pending_human_review'
  });

  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'system',
    resourceId: record._id.toString(),
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: {
      reportId,
      model: env.OPENAI_MODEL,
      language,
      requiresHumanReview: true
    }
  });

  return {
    interactionId: record._id,
    output,
    citations,
    guardrails: record.guardrails,
    reviewStatus: record.reviewStatus
  };
};

const buildReportContext = async (
  owner: AiOwner,
  reportId: string | undefined
): Promise<{ report: HydratedReportDocument | null; citations: AiCitation[] }> => {
  const report = await getOwnedReport(owner, reportId);
  const citations = [
    ...reportCitation(report),
    ...(await getReportEvidenceCitations(owner, report))
  ];

  return { report, citations };
};

type TriageFallbackReason =
  | 'none'
  | 'insufficient_input'
  | 'crisis_safety'
  | 'legal_advice_risk'
  | 'clinical_advice_risk';

type TriageSafetyFlags = {
  legalAdviceRisk: boolean;
  clinicalAdviceRisk: boolean;
  crisisRisk: boolean;
  insufficientInput: boolean;
};

type TriageResourceRecommendation = {
  title: string;
  body: string;
  type: string;
};

const TRIAGE_SEVERITY_VALUES = new Set(['low', 'medium', 'high', 'urgent']);

const toStringValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeStringList = (value: unknown, fallback: string[] = []): string[] => {
  if (Array.isArray(value)) {
    const values = value
      .map((item) => toStringValue(item))
      .filter(Boolean)
      .slice(0, 8);

    return values.length > 0 ? values : fallback;
  }

  const stringValue = toStringValue(value);

  return stringValue ? [stringValue] : fallback;
};

const normalizeResourceRecommendations = (value: unknown): TriageResourceRecommendation[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = toStringValue(record.title);
      const body = toStringValue(record.body);
      const type = toStringValue(record.type);

      if (!title || !body) {
        return null;
      }

      return { title, body, type: type || 'support' };
    })
    .filter((item): item is TriageResourceRecommendation => Boolean(item))
    .slice(0, 6);
};

const stripRepeatedDisclaimer = (text: string, disclaimer: string): string =>
  text.replace(new RegExp(disclaimer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();

const sanitizeTriageText = (value: unknown, disclaimer: string, fallback: string): string => {
  const text = toStringValue(value) || fallback;
  const sanitized = enforceAiOutputGuardrails(text);

  return stripRepeatedDisclaimer(sanitized, disclaimer) || fallback;
};

const normalizeTriageSeverity = (value: unknown, flags: TriageSafetyFlags): string => {
  const candidate = toStringValue(value).toLowerCase();

  if (flags.crisisRisk) {
    return 'urgent';
  }

  return TRIAGE_SEVERITY_VALUES.has(candidate) ? candidate : 'medium';
};

const buildTriageFlags = (
  narrative: string,
  structuredFields: Record<string, unknown> | undefined,
  modelOutput: Record<string, unknown>
): TriageSafetyFlags => {
  const structuredText = JSON.stringify(structuredFields ?? {});
  const combinedText = `${narrative}\n${structuredText}\n${JSON.stringify(modelOutput)}`;
  const inputText = `${narrative}\n${structuredText}`.replace(/[{}[\]":,_-]/g, ' ').trim();

  return {
    legalAdviceRisk: detectLegalAdviceRisk(combinedText),
    clinicalAdviceRisk: detectClinicalAdviceRisk(combinedText),
    crisisRisk: detectCrisisRisk(combinedText),
    insufficientInput: inputText.length < 24
  };
};

const buildTriageFallbackReason = (flags: TriageSafetyFlags): TriageFallbackReason => {
  if (flags.crisisRisk) {
    return 'crisis_safety';
  }

  if (flags.legalAdviceRisk) {
    return 'legal_advice_risk';
  }

  if (flags.clinicalAdviceRisk) {
    return 'clinical_advice_risk';
  }

  if (flags.insufficientInput) {
    return 'insufficient_input';
  }

  return 'none';
};

const normalizeTriageConfidence = (
  modelConfidence: unknown,
  flags: TriageSafetyFlags,
  citations: AiCitation[]
): 'low' | 'medium' | 'high' => {
  const candidate = toStringValue(modelConfidence).toLowerCase();

  if (
    flags.crisisRisk ||
    flags.legalAdviceRisk ||
    flags.clinicalAdviceRisk ||
    flags.insufficientInput
  ) {
    return 'low';
  }

  if (candidate === 'high' || candidate === 'medium' || candidate === 'low') {
    return candidate;
  }

  return citations.length > 0 ? 'medium' : 'low';
};

const normalizeTriageOutput = (input: {
  modelOutput: Record<string, unknown>;
  narrative: string;
  structuredFields?: Record<string, unknown>;
  citations: AiCitation[];
  disclaimer: string;
  humanReviewText: string;
  fallbackText: string;
}): Record<string, unknown> => {
  const flags = buildTriageFlags(input.narrative, input.structuredFields, input.modelOutput);
  const fallbackReason = buildTriageFallbackReason(flags);
  const pendingHumanReview = shouldRequireHumanReview({
    legalAdviceRisk: flags.legalAdviceRisk,
    clinicalAdviceRisk: flags.clinicalAdviceRisk,
    crisisRisk: flags.crisisRisk,
    insufficientSources: false,
    insufficientInput: flags.insufficientInput
  });
  const summaryFallback =
    fallbackReason === 'crisis_safety'
      ? 'Immediate safety may be a concern. If there is immediate danger, call 000 now.'
      : input.fallbackText;
  const assessmentFallback =
    fallbackReason === 'none'
      ? input.fallbackText
      : `${summaryFallback} ${input.humanReviewText}`;
  const normalizedSummary = sanitizeTriageText(
    input.modelOutput.summary,
    input.disclaimer,
    summaryFallback
  );
  const normalizedAssessment = sanitizeTriageText(
    input.modelOutput.assessmentBody,
    input.disclaimer,
    assessmentFallback
  );

  return {
    severitySignal: normalizeTriageSeverity(input.modelOutput.severitySignal, flags),
    primarySupportNeed:
      sanitizeTriageText(input.modelOutput.primarySupportNeed, input.disclaimer, 'Support options'),
    specialtyTag:
      sanitizeTriageText(input.modelOutput.specialtyTag, input.disclaimer, 'general support')
        .toLowerCase()
        .slice(0, 80),
    summary: normalizedSummary,
    assessmentBody: normalizedAssessment,
    riskFactors: normalizeStringList(input.modelOutput.riskFactors),
    suggestedSupportCategories: normalizeStringList(input.modelOutput.suggestedSupportCategories, [
      'support'
    ]),
    recommendedActions: normalizeStringList(input.modelOutput.recommendedActions, [
      'Document what happened if safe to do so',
      'Consider contacting an official support service'
    ]),
    resourceRecommendations: normalizeResourceRecommendations(input.modelOutput.resourceRecommendations),
    nonLegalSafetyNotes: normalizeStringList(input.modelOutput.nonLegalSafetyNotes, [
      input.disclaimer
    ]),
    immediateSafetyFlag: flags.crisisRisk || Boolean(input.modelOutput.immediateSafetyFlag),
    confidence: normalizeTriageConfidence(input.modelOutput.confidence, flags, input.citations),
    citations: input.citations,
    fallbackReason,
    pendingHumanReview,
    safetyFlags: flags,
    disclaimer: input.disclaimer,
    humanReviewNote: input.humanReviewText,
    reviewStatus: 'pending_human_review'
  };
};

export const extractIncidentFields = async (
  context: AiServiceContext,
  input: ExtractIncidentFieldsInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const { citations } = await buildReportContext(context.owner, input.reportId);
  const language = input.language ?? DEFAULT_AI_LANGUAGE;
  const taxonomyCatalog = await getTaxonomyCatalog();
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    [
      'Extract incident fields as JSON with keys: incidentType, who, what, when, where, how, risks, evidenceMentioned, missingInformation, citations, reviewStatus.',
      `Use the closest active incident_type taxonomy key for incidentType when possible: ${formatTaxonomyPromptList(taxonomyCatalog.incidentTypes)}.`,
      `Narrative: ${input.narrative}`
    ].join(' ')
  );

  return recordAiInteraction(
    context,
    AI_ACTIONS.extractIncidentFields,
    input,
    output,
    language,
    citations,
    input.reportId
  );
};

export const triageReport = async (
  context: AiServiceContext,
  input: TriageReportInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const { report, citations } = await buildReportContext(context.owner, input.reportId);
  const platformSettings = await getPublicPlatformSettings({});
  const aiSettings = platformSettings.settings.ai;
  const language = input.language ?? report?.language ?? DEFAULT_AI_LANGUAGE;
  const narrative =
    input.narrative ?? report?.originalNarrative ?? report?.translatedNarrative ?? '';
  const taxonomyCatalog = await getTaxonomyCatalog();
  const output = await callOpenAIJson<Record<string, unknown>>(
    `${systemPrompt(language)} ${aiSettings.triageSystemPrompt}`,
    [
      'Triage this report for information-only support.',
      'Return valid JSON only.',
      aiSettings.triageResponseTemplate,
      'Use keys: severitySignal, primarySupportNeed, specialtyTag, summary, assessmentBody, riskFactors, suggestedSupportCategories, recommendedActions, resourceRecommendations, nonLegalSafetyNotes, immediateSafetyFlag, confidence, citations, fallbackReason, pendingHumanReview, safetyFlags, disclaimer, reviewStatus.',
      'severitySignal should be one of: low, medium, high, urgent.',
      `Active incident_type taxonomy: ${formatTaxonomyPromptList(taxonomyCatalog.incidentTypes)}.`,
      `Active support_need taxonomy: ${formatTaxonomyPromptList(taxonomyCatalog.supportNeeds)}.`,
      'primarySupportNeed should use an active support_need label when one fits, otherwise a concise human-readable support label.',
      'suggestedSupportCategories should prefer active support_need keys or labels when relevant.',
      'specialtyTag should be a short lowercase tag, 1 to 3 words.',
      'summary and assessmentBody should be concise and information-only.',
      'riskFactors, suggestedSupportCategories, recommendedActions, and nonLegalSafetyNotes should be short arrays of strings.',
      'resourceRecommendations should be an array of objects with title, body, and type.',
      'immediateSafetyFlag should be true only if the user appears unsafe or at immediate risk.',
      input.incidentCategory
        ? `The report came from the quick-start category: ${input.incidentCategory}. Use it to tailor support and resources, but do not invent facts not grounded in the narrative or structured fields.`
        : 'No quick-start category was provided.',
      `Narrative: ${narrative}`,
      `Structured fields: ${JSON.stringify(input.structuredFields ?? report?.structuredFields ?? {})}`
    ].join(' ')
  );
  const normalizedOutput = normalizeTriageOutput({
    modelOutput: output,
    narrative,
    structuredFields: input.structuredFields ?? report?.structuredFields,
    citations,
    disclaimer: aiSettings.disclaimerText || buildInformationOnlyDisclaimer(),
    humanReviewText: aiSettings.humanReviewText,
    fallbackText: aiSettings.triageFallbackText
  });

  const interaction = await recordAiInteraction(
    context,
    AI_ACTIONS.triageReport,
    input,
    normalizedOutput,
    language,
    citations,
    input.reportId
  );

  return {
    ...normalizedOutput,
    citations,
    guardrails: interaction.guardrails,
    reviewStatus: interaction.reviewStatus,
    interactionId: interaction.interactionId,
    templateVersion: platformSettings.version,
    templateStatus: aiSettings.triageTemplateStatus
  };
};

export const generateClarifyingQuestions = async (
  context: AiServiceContext,
  input: ClarifyingQuestionsInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const { citations } = await buildReportContext(context.owner, input.reportId);
  const language = input.language ?? DEFAULT_AI_LANGUAGE;
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    `Generate up to ${input.maxQuestions} trauma-informed clarifying questions. Return JSON with questions array, rationale, citations, reviewStatus. Narrative: ${input.narrative}. Structured fields: ${JSON.stringify(input.structuredFields ?? {})}`
  );

  return recordAiInteraction(
    context,
    AI_ACTIONS.clarifyingQuestions,
    input,
    output,
    language,
    citations,
    input.reportId
  );
};

export const generateSummary = async (
  context: AiServiceContext,
  input: GenerateSummaryInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const { report, citations } = await buildReportContext(context.owner, input.reportId);
  const language = input.language ?? report?.language ?? DEFAULT_AI_LANGUAGE;
  const narrative =
    input.narrative ?? report?.originalNarrative ?? report?.translatedNarrative ?? '';
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    `Create an information-only summary for audience ${input.audience}. Return JSON with summary, keyFacts, uncertaintyNotes, citations, reviewStatus. Narrative: ${narrative}. Structured fields: ${JSON.stringify(input.structuredFields ?? report?.structuredFields ?? {})}`
  );

  return recordAiInteraction(
    context,
    AI_ACTIONS.generateSummary,
    input,
    output,
    language,
    citations,
    input.reportId
  );
};

export const translateText = async (
  context: AiServiceContext,
  input: TranslateInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(input.targetLanguage),
    `Translate the text. Preserve meaning and tone. Return JSON with translatedText, sourceLanguage, targetLanguage, reviewStatus. Source language: ${input.sourceLanguage ?? 'auto-detect'}. Text: ${input.text}`
  );

  return recordAiInteraction(context, AI_ACTIONS.translate, input, output, input.targetLanguage, [
    { sourceType: 'user_input', excerpt: input.text.slice(0, 400) }
  ]);
};

export const redactPii = async (
  context: AiServiceContext,
  input: RedactPiiInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const language = input.language ?? DEFAULT_AI_LANGUAGE;
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    `Redact personally identifiable information. Return JSON with redactedText, detectedEntities, replacementStyle, reviewStatus. Replacement style: ${input.replacementStyle}. Text: ${input.text}`
  );

  return recordAiInteraction(context, AI_ACTIONS.redactPii, input, output, language, [
    { sourceType: 'user_input', excerpt: input.text.slice(0, 400) }
  ]);
};

export const answerWithContext = async (
  context: AiServiceContext,
  input: { question: string; language?: string; citations: AiCitation[]; contextText: string }
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const language = input.language ?? DEFAULT_AI_LANGUAGE;
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    `Answer using only the supplied context. If context is insufficient, say so. Return JSON with answer, citations, limitations, reviewStatus. Question: ${input.question}. Context: ${input.contextText}`
  );

  return recordAiInteraction(
    context,
    AI_ACTIONS.ragAnswer,
    input,
    output,
    language,
    input.citations
  );
};

export const generateTimelineAssistantTurn = async (
  context: AiServiceContext,
  input: {
    message: string;
    conversation: Array<{ role: 'assistant' | 'user'; content: string }>;
    timeline: Record<string, unknown>;
    language?: string;
    incidentCategory?: string;
    contextText: string;
    citations: AiCitation[];
    ragUnavailable?: boolean;
  }
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const language = input.language ?? DEFAULT_AI_LANGUAGE;
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    [
      'You are the SafeSpeak timeline builder for a personal incident report.',
      'Use only the user conversation and supplied RAG context.',
      'Support two behaviors in the same flow: a flexible conversational mode and a structured timeline-builder mode.',
      'Your tone must feel calm, warm, validating, and human.',
      'Sound like a supportive person, not a robotic assistant, legal form, or policy engine.',
      'Your first priority is emotional support and helping the person feel heard.',
      'Use no-panic language. Do not alarm the user, shame them, blame them, or question whether they are telling the truth.',
      'Use clear plain English. Avoid legal jargon, clinical jargon, and formal labels unless the user asks for them or they are needed for a simple option.',
      'Offer choices, not commands. Use phrases like "you can", "one option is", and "if it feels safe".',
      'For mental stress, loneliness, trauma, or overwhelm, respond with gentle emotional support before timeline questions.',
      'For domestic or family violence, threats, coercive control, stalking, or fear, be trauma-informed and prioritize safety without pressuring the user to report.',
      'If the user mentions suicide, self-harm, immediate danger, weapons, strangulation, or being unsafe right now, calmly say that if they are in immediate danger they can call 000, and ask one short safety question.',
      'Before trying to collect timeline details, respond like a caring human when the user shares something painful, frightening, humiliating, or overwhelming.',
      'Acknowledge what the user shared in a natural way before asking for more detail when that is appropriate.',
      'Use brief empathetic phrases such as "I am sorry that happened", "That sounds upsetting", "Thank you for telling me", or similar natural wording when appropriate.',
      'Do not jump straight into form-like questions if the user has just described harm.',
      'Use empathy and simple language, especially for sensitive topics like domestic violence, racial abuse, migrant stress, family harm, threats, or fear.',
      'After the empathetic response, gently ask only one useful next question that helps build the timeline.',
      'If the user greets you, hesitates, expresses emotion, asks for clarification, or responds with something too vague to capture incident details, reply naturally and supportively in assistantMessage first.',
      'When appropriate, use nextQuestion to guide the user back to one short trauma-informed timeline question at a time.',
      'If the user already shared concrete incident details, prioritize structured timeline-building and keep the nextQuestion focused on the single most useful missing field.',
      'Keep assistantMessage brief and easy to read.',
      'Prefer 2 short sentences when empathy is needed: first emotional support, then gentle guidance.',
      'Do not sound repetitive, scripted, or overly formal.',
      'Avoid phrases like "this information is for general awareness only" or "does not constitute legal advice" inside normal turn-by-turn conversation unless the user directly asks for legal advice or the response truly requires a boundary.',
      'Do not mention confidence, citations, review status, training data, or system limitations in assistantMessage.',
      'Avoid repeating the same disclaimer or reassurance on every turn.',
      'Do not restate the full user message unless necessary for clarity.',
      'If nextQuestion is used, it must be one short direct question.',
      'Do not pressure the user to continue, report, or name people.',
      'Never say the incident is definitely a crime, discrimination, abuse, or a legal breach. Use careful phrases like "may involve" or "could fit".',
      'Do not provide legal, medical, therapeutic, or crisis instructions beyond the SafeSpeak information-only guardrails.',
      'Return valid JSON with keys: assistantMessage, nextQuestion, timeline, readyForSubmission, confidence, citations, reviewStatus.',
      'assistantMessage should be able to stand alone as a natural response.',
      'nextQuestion is optional and should be empty when a follow-up question is not needed on that turn.',
      'timeline must be a JSON object of concise snake_case field names to concise string values.',
      'Only include fields that are already known from the conversation or clearly necessary to build a useful incident timeline.',
      'Prefer these keys when relevant: who, relationship, what, where, when, how, frequency, impact, threats, injuries, witnesses, evidence, actions_taken, unsafe_now.',
      'If the latest user message clearly states the incident type or actor, capture that immediately in timeline on the same turn instead of waiting for a later message.',
      'Do not force a timeline question immediately after greetings like hi, hello, hey, or similar small talk unless the user also gave incident details.',
      'Do not include empty fields, duplicate fields, speculative fields, or keys that are not grounded in the conversation.',
      'Keep each timeline value short, specific, and compressed.',
      'Do not copy the full user message into timeline fields.',
      'For what, capture the core incident action in a short phrase, not the setup or greeting.',
      'For where, capture only the place.',
      'For when, capture only the time expression.',
      'For who, capture only the actor or person label.',
      'Prefer short keyword-like phrases instead of sentences wherever possible.',
      'Examples:',
      'User: "Hey, I was just walking into the street and someone pulled my hijab."',
      'timeline.what: "someone pulled my hijab"',
      'timeline.where: "on the street" only if clearly supported.',
      'timeline.when should stay empty unless the user gave a time.',
      'If the user provides a long detail, compress it into a short factual phrase, usually 2 to 10 words per field.',
      input.ragUnavailable
        ? 'RAG retrieval was unavailable for this turn; say limitations clearly if needed.'
        : 'Use the RAG context only when it is relevant and cite it in citations.',
      input.incidentCategory
        ? `The user entered from the quick-start category: ${input.incidentCategory}. Use that as context for tone, likely support needs, and relevant follow-up questions, but do not assume facts the user has not stated.`
        : 'No quick-start category was provided.',
      `Latest user message: ${input.message}`,
      `Existing conversation: ${JSON.stringify(input.conversation)}`,
      `Existing timeline: ${JSON.stringify(input.timeline)}`,
      `RAG context: ${input.contextText || 'No approved RAG context was retrieved.'}`
    ].join('\n')
  );

  return recordAiInteraction(
    context,
    AI_ACTIONS.timelineAssistant,
    input,
    output,
    language,
    input.citations
  );
};

export const transcribeAudio = async (
  context: AiServiceContext,
  input: TranscribeAudioBodyInput,
  file: EvidenceUploadFile | undefined
): Promise<Record<string, unknown>> => {
  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'audio file is required');
  }

  const consent = await getCurrentConsent(ownerFilter(context.owner));
  if (!consent.process_with_ai && !consent.transcribe_audio) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai or transcribe_audio consent is required for transcription'
    );
  }

  const transcription = await transcribeAudioBuffer({
    buffer: file.buffer,
    fileName: file.originalname,
    mimeType: file.mimetype,
    language: input.language
  });

  if (input.evidenceId && input.saveTranscript !== false) {
    await saveTranscriptionToEvidence(
      ownerFilter(context.owner),
      input.evidenceId,
      {
        text: transcription.transcript,
        language: transcription.language,
        model: transcription.model,
        provider: transcription.provider
      }
    );
  }

  if (input.reportId) {
    const report = await getOwnedReport(ownerFilter(context.owner), input.reportId);
    if (!report) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found');
    }

    if (input.useAsNarrative) {
      if (!(report.consentSnapshot as { cloud_sync?: boolean })?.cloud_sync) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          'cloud_sync consent is required to store transcription as report narrative'
        );
      }
      report.originalNarrative = transcription.transcript;
    } else {
      report.structuredFields = {
        ...report.structuredFields,
        transcription: {
          available: true,
          language: transcription.language,
          model: transcription.model
        }
      };
    }

    await report.save();
  }

  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action: AI_ACTIONS.audioTranscriptionRequested,
    resourceType: 'system',
    resourceId: input.reportId ?? input.evidenceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: {
      model: transcription.model,
      provider: transcription.provider,
      reportId: input.reportId,
      evidenceId: input.evidenceId,
      saved: input.saveTranscript !== false
    }
  });

  return {
    transcript: transcription.transcript,
    language: transcription.language,
    model: transcription.model,
    reportId: input.reportId,
    evidenceId: input.evidenceId,
    saved: input.saveTranscript !== false
  };
};
