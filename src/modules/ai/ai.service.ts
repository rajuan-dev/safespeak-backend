import { createHash } from 'node:crypto';

import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';
import { EvidenceModel } from '@modules/evidence/evidence.model';
import { ReportModel, type ReportDocument } from '@modules/reports/reports.model';
import { getSafeSpeakSystemPrompt } from './ai-guardrails';

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

  try {
    return JSON.parse(text) as TOutput;
  } catch {
    return { text } as TOutput;
  }
};

const systemPrompt = (language: string): string => getSafeSpeakSystemPrompt(language);

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

export const extractIncidentFields = async (
  context: AiServiceContext,
  input: ExtractIncidentFieldsInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const { citations } = await buildReportContext(context.owner, input.reportId);
  const language = input.language ?? DEFAULT_AI_LANGUAGE;
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    `Extract incident fields as JSON with keys: incidentType, who, what, when, where, how, risks, evidenceMentioned, missingInformation, citations, reviewStatus. Narrative: ${input.narrative}`
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
  const language = input.language ?? report?.language ?? DEFAULT_AI_LANGUAGE;
  const narrative =
    input.narrative ?? report?.originalNarrative ?? report?.translatedNarrative ?? '';
  const output = await callOpenAIJson<Record<string, unknown>>(
    systemPrompt(language),
    `Triage this report for information-only support. Return JSON with severitySignal, riskFactors, suggestedSupportCategories, nonLegalSafetyNotes, citations, reviewStatus. Narrative: ${narrative}. Structured fields: ${JSON.stringify(input.structuredFields ?? report?.structuredFields ?? {})}`
  );

  return recordAiInteraction(
    context,
    AI_ACTIONS.triageReport,
    input,
    output,
    language,
    citations,
    input.reportId
  );
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
