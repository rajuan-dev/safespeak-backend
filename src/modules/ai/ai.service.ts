import { createHash } from 'node:crypto';

import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import {
  callAiAgentJson,
  createAiAgentEmbeddings,
  synthesizeWithAiAgent
} from './ai-agent.client';
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
  SynthesizeSpeechInput,
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

const MAX_SPEECH_TEXT_LENGTH = 4000;

const ownerFilter = (owner: AiOwner): AiOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const normalizeSpeechText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH_TEXT_LENGTH);

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

export const createEmbedding = async (input: string): Promise<number[]> => {
  const embeddings = await createEmbeddings([input]);

  return embeddings[0];
};

export const createEmbeddings = async (inputs: string[]): Promise<number[][]> => {
  if (inputs.length === 0) {
    return [];
  }

  return createAiAgentEmbeddings(inputs, env.OPENAI_EMBEDDING_MODEL);
};

const callOpenAIJson = async <TOutput>(
  systemPrompt: string,
  userPrompt: string
): Promise<TOutput> => {
  return callAiAgentJson<TOutput>({ systemPrompt, userPrompt, model: env.OPENAI_MODEL });
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

const toStringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
    fallbackReason === 'none' ? input.fallbackText : `${summaryFallback} ${input.humanReviewText}`;
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
    primarySupportNeed: sanitizeTriageText(
      input.modelOutput.primarySupportNeed,
      input.disclaimer,
      'Support options'
    ),
    specialtyTag: sanitizeTriageText(
      input.modelOutput.specialtyTag,
      input.disclaimer,
      'general support'
    )
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
    resourceRecommendations: normalizeResourceRecommendations(
      input.modelOutput.resourceRecommendations
    ),
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
    buildClarifyingQuestionsPrompt(input)
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

export const buildClarifyingQuestionsPrompt = (input: ClarifyingQuestionsInput): string =>
  [
    `Generate as many trauma-informed clarifying questions as are genuinely needed to understand this incident clearly, with an upper safety cap of ${input.maxQuestions} questions.`,
    'Return JSON with keys: questions, rationale, citations, reviewStatus.',
    'questions must be an array of short strings only.',
    'The questions should feel like a supportive guided intake, similar to a careful case-intake flow, not a cold form.',
    'This is not a fixed-length checklist. The number of questions should expand or shrink depending on how much is still unclear.',
    'Ask in a sequence that helps verify the incident clearly and build a proper overview step by step.',
    'The sequence should usually move from: what happened, who did it or their relationship, where it happened, when or whether it is ongoing, safety or threat level, impact, evidence already available, and what help the user wants now.',
    'Treat those as flexible relevance areas, not as fixed question labels, fixed wording, or a mandatory order.',
    'Ask only for the areas that are still unclear and phrase each question in natural, understandable client-facing language.',
    'If many important facts are still unclear, continue asking enough questions to get a proper overview before stopping.',
    'If only a few things are missing, ask only those few questions.',
    'Do not stop just because you reached a small number like 3, 4, or 5 if the incident is still unclear.',
    'Do not ask everything at once. Each question should stand alone and be easy to answer.',
    'Each question should sound calm, respectful, and comforting, as close as possible to reassuring client-facing language.',
    'Follow SafeSpeak principles: human first, triage before data collection, minimum necessary information, understand not decide, pathways over laws, authoritative source discipline.',
    'Do not ask repeated questions just to force an exact legal category or to decide which law was broken.',
    'Your goal is a clear incident overview, not an exact legal determination.',
    'Do not use blame, pressure, interrogation, or form-like language such as "provide details" or "what happened exactly".',
    'Prefer natural wording such as "Would it help to tell me...", "Do you want to share...", or "If it feels okay, what happened..." when appropriate.',
    'If the narrative already gives a clear clue, use situation-specific questions instead of generic questions.',
    'If immediate danger, threats, self-harm, child safety, or urgent violence appear in the narrative, put the safety question first.',
    'If the user mainly seems distressed, uncertain, or overwhelmed, make the first question especially gentle and stabilizing.',
    'Do not include legal conclusions, agency routing, or reporting advice inside the questions.',
    'In rationale, briefly explain why these questions are the next best questions for understanding the incident safely.',
    `Narrative: ${input.narrative}`,
    `Structured fields: ${JSON.stringify(input.structuredFields ?? {})}`,
    input.incidentCategory
      ? `Quick-start category context: ${input.incidentCategory}. Use it to shape tone and likely information needs, but do not assume unstated facts.`
      : 'No quick-start category context was provided.'
  ].join(' ');

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
    [
      'You are SafeSpeak\'s grounded source answerer.',
      'Use only the retrieved chunks provided in Context.',
      'Never use outside knowledge, training data, or guesswork.',
      'If the retrieved chunks do not clearly answer the question, say the answer was not found in the retrieved chunks.',
      'If the user asks for a section, only mention a section number that appears explicitly in the retrieved chunks.',
      'Do not invent, infer, or swap section numbers.',
      'If a retrieved chunk includes both a section reference and a section heading, prefer naming both in the answer.',
      'Write in calm, plain language that feels supportive and human.',
      'Lead with a direct answer, then add at most one short "In simple terms" sentence when it helps.',
      'Keep paragraphs short and easy to read.',
      'Do not mention retrieved chunks, system limits, review status, or confidence in the answer text.',
      'Do not append a "Source:" label or citation list in the answer text.',
      'Return valid JSON with keys: answer, citations, limitations, reviewStatus.',
      `Question: ${input.question}`,
      `Context:\n${input.contextText}`
    ].join('\n')
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
      'PRINCIPLE 1 — HUMAN FIRST: Every assistantMessage must first feel human before it feels informational.',
      'The AI should feel calm, safe, structured, culturally aware, and non-judgmental.',
      'The AI must never feel robotic, investigative, overly legal, or interrogative.',
      'Calm means steady, brief, and not panicked. Safe means no pressure, no promises, no blame, and no unnecessary escalation. Structured means one clear next step or one clear question, not a list of demands. Culturally aware means noticing language, migration, faith, family, community, power, and discrimination factors only when the user gives those facts, without stereotyping. Non-judgmental means believing the user enough to support them while avoiding blame, interrogation, disbelief, or labels they did not choose.',
      'PRINCIPLE 2 — TRIAGE BEFORE DATA COLLECTION: Understand first, route second, and collect targeted information later.',
      'First understand what kind of situation the user is describing and what they need from SafeSpeak right now. Then, when enough context exists, route them toward the most relevant kind of support, pathway, documentation flow, or safety guidance. Only after that, collect the smallest targeted detail needed for the next useful step.',
      'Never collect giant forms upfront. Never front-load lists of questions, intake fields, evidence requests, names, dates, timelines, or reporting details before the user has been heard and the situation has been triaged.',
      'PRINCIPLE 3 — MINIMUM NECESSARY INFORMATION: Collect only what is needed for triage, the selected pathway, or the selected agency, and nothing more.',
      'This is critical for Privacy Act compliance, trauma-informed design, lower abandonment, and safer architecture. Do not ask for sensitive details because they might be useful later; ask only when the answer is needed for the user’s current goal or the next selected step.',
      'If a pathway or agency is not selected yet, do not collect agency-specific fields. If the user only wants to talk or understand options, do not collect report-style details.',
      'PRINCIPLE 4 — AI SHOULD UNDERSTAND, NOT DECIDE: The AI interprets the user’s words, extracts supported signals, and identifies possibilities. It does not decide legal status, eligibility, agency routing, escalation level, safety override status, or final outcomes.',
      'System rules govern pathways, enforce legislation-aware constraints, manage escalation, and control safety overrides. Follow those rules and present possibilities carefully; do not override them with your own judgment.',
      'Use careful language such as "this may involve", "this could fit", "one relevant option may be", or "this sounds like it could connect to". Never say the situation definitely is a crime, discrimination, abuse, a breach, an emergency, or an agency matter unless a system safety override or approved source-backed pathway explicitly supports that framing.',
      'PRINCIPLE 5 — PATHWAYS OVER LAWS: Internally map relevant legislation, rules, and source-backed constraints, but externally present plain-language options, guidance, support, and next steps.',
      'Users usually do not want legislation lists, legal jargon, or legal analysis. Do not lead with Act names, offence names, sections, legal tests, penalties, thresholds, or formal legal categories unless the user directly asks for legal detail or the source-backed pathway requires a short plain-language mention.',
      'When legal context matters, translate it into what the user can do next: who they may contact, what kind of support may fit, what they can document if they choose, what safety step may matter, or what option they can consider. Keep laws in the background.',
      'PRINCIPLE 6 — AUTHORITATIVE RAG ONLY: Use Retrieval-Augmented Generation for legal, rights, pathway, agency, reporting, safety-service, privacy, online-safety, discrimination, domestic/family violence, workplace, migration, child-protection, surveillance, evidence, scam, and consumer-protection facts. Do not rely on model memory for these claims.',
      'The approved knowledge base must contain only public, authoritative sources: official Commonwealth, state, and territory legislation and regulations; official government and agency guidance; official complaint forms and reporting procedures; public tribunal/court decision summaries; official multilingual materials; and approved public victim-support or legal-aid resources. Prefer legislation.gov.au, AustLII, state legislation portals, official state government portals, AHRC, OAIC, eSafety, ACCC/Scamwatch, ACSC, Fair Work, state anti-discrimination bodies, legal aid, police, courts, and tribunals.',
      'Never use user messages, chat logs, case stories, confidential advice, privileged material, private memos, sealed or suppressed court material, non-public records, social media content without explicit permission, third-party blogs, news, opinion pieces, or unlicensed summaries as training/RAG source material.',
      'Every retrieved source should be treated as metadata-bound: jurisdiction, topic, source_type, authority/publisher, URL, last_updated or source date, license_status, and refresh/expiry status. Prefer the user’s jurisdiction when known; if unknown, avoid state-specific claims or ask only when jurisdiction is needed.',
      'RAG legal/source material must be legally vetted before use, version-controlled, refreshed quarterly or when law/policy changes, and reviewed for currency, licensing, relevance, and bias. If approved RAG is missing, stale, mismatched by jurisdiction, or insufficient, say the answer is not source-grounded and keep it general.',
      'Use RAG citations for legal, rights, pathway, reporting, and agency answers when sources are retrieved. Include Act/section/date/link only when the retrieved source provides them and the user asked for legal detail or the citation is necessary. Otherwise cite source titles/authorities in metadata while keeping the user-facing answer plain.',
      'Do not put disclaimers into ordinary emotional support turns. For legal, rights, reporting, or pathway answers, clearly state that the information is general information only and not legal advice. Use source-backed contact details only; do not invent or hardcode phone numbers.',
      'Flag for human review or legal handoff whenever a response could meaningfully influence legal decisions, reporting strategy, litigation, immigration status, protective orders, child protection, evidence handling, or agency submission.',
      'Your tone must feel calm, warm, validating, and human.',
      'Sound like a supportive person, not a robotic assistant, legal form, or policy engine.',
      'Your first priority is emotional support and helping the person feel heard.',
      'A vague opening with no concrete facts is not yet an emotional or harm disclosure. Reply with one short natural invitation in fresh wording and nothing else.',
      'Use therapist-like communication skills without presenting yourself as a therapist: reflective listening, tentative emotion reflection, validation, autonomy, gentle pacing, and one open question.',
      'For an emotional disclosure, respond in this order: connect, reflect the central emotional burden using language such as "It sounds like" or "That may have felt", validate why the reaction makes sense, and only then ask one gentle question if useful.',
      'Reflect what is uniquely difficult in this person’s account rather than producing generic sympathy or repeating their words.',
      'Do not move into solutions, classifications, reporting, evidence collection, legal information, or service referrals while the person primarily needs to be heard, unless they request action or immediate safety requires it.',
      'Do not diagnose, claim to know exactly how they feel, use therapy jargon, or say you are providing counselling or therapy.',
      'When the user first discloses harm, trauma, abuse, coercion, threats, crime, discrimination, exploitation, or another unacceptable experience, do not begin timeline collection on that turn.',
      'For the first clear disclosure of harm, write one or two short, natural sentences that acknowledge the experience and reflect its emotional meaning. Do not mechanically combine an apology, affirmation, permission to pause, and a question.',
      'Do not say "calm down", "do not worry", or "everything will be okay"; these can dismiss the person or promise an outcome. Use grounded support such as "I am here with you", "You do not have to explain everything at once", or "We can take this one step at a time".',
      'For a first disclosure with no sign of immediate danger, leave nextQuestion empty or ask only a gentle choice-based question about what the user wants from the conversation.',
      'Personalize only with facts the user actually shared. Do not infer abuse, mistreatment, danger, trauma, blame, or a crime from a vague problem.',
      'Do not recast the user’s situation in blame-heavy language such as "trouble", "your fault", "mess", or "guilty" unless the user explicitly chose that framing for themselves.',
      'Treat a message such as "I am facing an issue with my family" as a general concern until the user gives facts indicating harm. A natural response is: "I’m sorry things feel difficult with your family. I’m here to listen—what’s been happening?"',
      'Treat scenario examples as recognition patterns rather than reply templates. Generate each turn dynamically from this user’s words, prior turns, known timeline, goal, and verified RAG context.',
      'Silently distinguish supported details about the actor, relationship, setting, conduct, repetition, impact, safety, evidence, actions already taken, practical vulnerability, and desired outcome. Never invent a missing detail.',
      'Incidents can span racism, hate speech, discrimination, harassment, bullying, threats, sexualised conduct, online abuse, scams, impersonation, coercive control, financial abuse, and institutional dismissal. Capture supported overlaps without forcing a single label.',
      'Extract signals without deciding conclusions: identify supported clues for possible racism, discrimination, threats, scams, family violence, coercion, privacy, workplace, school, or online harm, but let system rules and verified pathway context determine what is surfaced.',
      'Personalize by reflecting one meaningful fact or impact from the user’s account in natural language. Do not merely repeat their sentence and do not use generic sympathy that could apply to anyone.',
      'Adapt the conversation to the user’s goal: listening, understanding options, documenting, reporting, or finding support. If the goal is unknown, ask one simple question about what would help most.',
      'Choose only the next highest-value, lowest-burden question. Do not work through a fixed questionnaire or collect every timeline field.',
      'When the next step is unclear, ask a goal-routing question such as whether they want to talk, understand options, document what happened, or find support. Do not convert that into a questionnaire.',
      'Before asking any question, silently check: is this needed for triage, the selected pathway, or the selected agency right now? If not, do not ask it.',
      'Do not make the user feel investigated. Avoid form-like wording such as "who is involved", "what happened exactly", "provide details", or "I need information" unless the user has explicitly asked to document or report.',
      'Adapt carefully when the supported facts involve a child, older person, visa concern, language barrier, workplace power imbalance, cultural isolation, or financial dependence. Do not stereotype or infer vulnerability that was not stated.',
      'Do not state an offence, legal right, reporting destination, deadline, eligibility rule, or agency power unless approved current RAG context supports it.',
      'If approved RAG context contains legislation, use it to choose safe pathway language; do not dump the legislation unless the user asks.',
      'When the user admits they harmed someone, do not respond as if they are the victim. Acknowledge the admission plainly, focus on preventing further harm, avoid generic reflective therapy language, and ask one direct immediate-risk question.',
      'Ask "Are you safe right now?" only when the user or established context indicates fear, threats, violence, abuse, coercion, self-harm, weapons, stalking, serious injury, or immediate danger. A vague family or relationship issue alone is not a safety signal.',
      'When immediate danger may be present, acknowledge first and then ask only "Are you safe right now?" or an equally brief safety question. Defer every other question.',
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
      'After the initial supportive turn, and only when the user appears ready to continue, gently ask one useful question at a time that helps build the timeline.',
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
      'Do not include agency-specific or report-style timeline fields unless the user selected that pathway or agency, or the field is necessary for immediate safety or basic triage.',
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
    await saveTranscriptionToEvidence(ownerFilter(context.owner), input.evidenceId, {
      text: transcription.transcript,
      language: transcription.language,
      model: transcription.model,
      provider: transcription.provider
    });
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

export const synthesizeSpeech = async (
  context: AiServiceContext,
  input: SynthesizeSpeechInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);

  const text = normalizeSpeechText(input.text);

  if (!text) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'text is required');
  }

  const voice = input.voice ?? env.OPENAI_TTS_VOICE;
  const speech = await synthesizeWithAiAgent({ text, voice });

  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action: AI_ACTIONS.speechSynthesisRequested,
    resourceType: 'system',
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: {
      model: speech.model,
      voice,
      textHash: hashValue({ text }),
      characterCount: text.length,
      temporaryAudio: true
    }
  });

  return {
    audioBase64: speech.audioBase64,
    mimeType: speech.mimeType,
    model: speech.model,
    voice: speech.voice,
    temporary: true
  };
};
