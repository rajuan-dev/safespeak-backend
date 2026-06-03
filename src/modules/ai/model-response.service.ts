import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';

import {
  buildCompactRetryInstruction,
  buildGuardrailRevisionInstruction,
  buildInformationOnlyDisclaimer,
  buildRawDevSystemPrompt,
  getSafeSpeakSystemPrompt,
  splitGuardrailViolations,
  validateSafeSpeakResponse
} from './ai-guardrails';
import type {
  SafeSpeakModelContext,
  SafeSpeakRagSnippet,
  SafeSpeakRagStatus
} from './safespeak-context-builder';
import type { SafeSpeakResponsePlan } from './safespeak-response-planner';

type GuardrailStatus = 'passed' | 'regenerated' | 'fallback';
type OpenAiResponseSource =
  | 'openai_model'
  | 'openai_model_with_rag'
  | 'openai_model_regenerated'
  | 'raw_openai_model'
  | 'emergency_override'
  | 'guardrail_fallback'
  | 'model_empty_fallback';

export type GenerateSafeSpeakResponseInput = {
  mode?: 'safespeak_model' | 'natural';
  model?: string;
  intent: string;
  intentConfidence?: 'high' | 'medium' | 'low';
  classifierSource?: 'rule' | 'model' | 'hybrid';
  context: SafeSpeakModelContext;
  ragContext?: SafeSpeakRagSnippet[];
  ragStatus?: SafeSpeakRagStatus;
  latestUserMessage: string;
};

export type GenerateSafeSpeakResponseOutput = {
  assistantMessage: string;
  nextQuestion: string;
  readyForSubmission: false;
  confidence: 'medium';
  disclaimer: string;
  citations: Array<{
    title: string;
    jurisdiction: string;
    sourceType: string;
    url?: string;
    lastUpdated?: string;
  }>;
  showSources: boolean;
  sourceDisplayReason:
    | 'legal_lookup'
    | 'explicit_citation_request'
    | 'hidden_support_reply'
    | 'triage_handoff'
    | 'not_directly_grounded';
  rag: {
    used: boolean;
    unavailable: boolean;
    resultCount: number;
  };
  reviewStatus: string;
  responseMode:
    | 'safespeak_model'
    | 'natural'
    | 'emergency_minimum_fallback'
    | 'guardrail_fallback'
    | 'model_empty_fallback';
  intent: string;
  usedModelGeneration: boolean;
  guardrailStatus: GuardrailStatus;
  fallbackReason?: string;
  staticTemplateUsed: false;
  consentSnapshot: SafeSpeakModelContext['consentSnapshot'];
  intentConfidence?: 'high' | 'medium' | 'low';
  classifierSource?: 'rule' | 'model' | 'hybrid';
  responseSource: OpenAiResponseSource;
  model: string;
  jurisdiction: 'AU';
  ragStatus: SafeSpeakRagStatus;
  selectedResponseSource: OpenAiResponseSource;
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const COMMON_MOJIBAKE_REPAIRS: Array<[RegExp, string]> = [
  [/ΓÇÖ/g, '’'],
  [/ΓÇ£/g, '“'],
  [/ΓÇ¥/g, '”'],
  [/ΓÇô/g, '–'],
  [/ΓÇö/g, '—'],
  [/â€™/g, '’'],
  [/â€œ/g, '“'],
  [/â€\x9D/g, '”'],
  [/â€“/g, '–'],
  [/â€”/g, '—'],
  [/â€˜/g, '‘'],
  [/â€¦/g, '…']
];

export const normalizeAssistantContent = (value: string): string =>
  COMMON_MOJIBAKE_REPAIRS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);

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

const buildRagPromptSection = (ragContext: SafeSpeakRagSnippet[]): string =>
  ragContext.length === 0
    ? 'RAG snippets: none.'
    : [
        'RAG snippets:',
        ...ragContext.map(
          (item, index) =>
            `${index + 1}. title=${item.sourceTitle}; authority=${item.sourceAuthority ?? 'n/a'}; jurisdiction=${item.jurisdiction}; stateOrTerritory=${
              item.stateOrTerritory ?? 'n/a'
            }; legalDomain=${item.legalDomain ?? 'n/a'}; pathwayCategory=${item.pathwayCategory ?? 'n/a'}; sourceType=${
              item.sourceType
            }; sectionNumber=${item.sectionNumber ?? 'n/a'}; sectionTitle=${
              item.sectionTitle ?? 'n/a'
            }; url=${item.url ?? 'n/a'}; lastUpdated=${item.lastUpdated ?? 'n/a'}; snippet=${item.relevantSnippet}`
        )
      ].join('\n');

type PromptStyle = 'default' | 'strict' | 'compact';

const buildNaturalUserPrompt = (input: GenerateSafeSpeakResponseInput): string => {
  const sections = [
    `Conversation summary: ${input.context.conversationSummary || 'No prior context.'}`,
    `Latest user message: ${input.latestUserMessage}`
  ];

  if (input.ragContext && input.ragContext.length > 0) {
    sections.push(buildRagPromptSection(input.ragContext));
  }

  sections.push('Reply directly to the latest user message in plain text.');

  return sections.join('\n');
};

const buildBasePromptSections = (
  input: GenerateSafeSpeakResponseInput,
  promptStyle: PromptStyle = 'default'
): string[] => {
  const basePrompt =
    promptStyle === 'compact'
      ? [
          `Intent: ${input.intent}`,
          `Persona: ${input.context.persona}`,
          `Intent policy: ${JSON.stringify(input.context.intentPolicy)}`,
          `Latest user message: ${input.latestUserMessage}`,
          `Detected language: ${input.context.detectedLanguage}`,
          `Format preference: ${input.context.assistantFormatPreference ?? 'paragraphs'}`,
          `Response plan: ${JSON.stringify(input.context.responsePlan)}`,
          `Key constraints: ${(input.context.constraints ?? []).join(' | ')}`,
          `RAG status: ${input.ragStatus ?? 'not_required'}`,
          buildRagPromptSection(input.ragContext ?? input.context.ragContext)
        ]
      : [
          `Intent: ${input.intent}`,
          `Persona: ${input.context.persona}`,
          `Intent policy: ${JSON.stringify(input.context.intentPolicy)}`,
          `Latest user message: ${input.latestUserMessage}`,
          `Assistant format preference: ${input.context.assistantFormatPreference ?? 'paragraphs'}`,
          `Response plan: ${JSON.stringify(input.context.responsePlan)}`,
          `SafeSpeak context JSON: ${JSON.stringify(input.context)}`,
          `RAG status: ${input.ragStatus ?? 'not_required'}`,
          buildRagPromptSection(input.ragContext ?? input.context.ragContext)
        ];

  return basePrompt;
};

const buildUserPrompt = (
  input: GenerateSafeSpeakResponseInput,
  promptStyle: PromptStyle = 'default'
): string =>
  (input.mode ?? env.AI_RESPONSE_MODE) === 'natural'
    ? buildNaturalUserPrompt(input)
    : [
        ...buildBasePromptSections(input, promptStyle),
        promptStyle === 'strict'
          ? buildGuardrailRevisionInstruction({
              intent: input.intent,
              latestUserMessage: input.latestUserMessage
            })
          : promptStyle === 'compact'
            ? 'Write one brief, natural SafeSpeak reply in plain text. Do not output JSON.'
            : 'Write the final assistant reply naturally. Do not output JSON.'
      ].join('\n');

const shouldPreferParagraphs = (input: GenerateSafeSpeakResponseInput): boolean => {
  if (
    input.intent === 'meta_feedback' ||
    input.intent === 'general_conversation' ||
    input.intent === 'language_or_translation' ||
    input.intent === 'encoding_error'
  ) {
    return true;
  }

  if (input.context.assistantFormatPreference === 'bullets') {
    return false;
  }

  if (
    /\b(bullet points?|steps?|options?|red flags?|warning signs?|organize|organise|summary|explain more)\b/i.test(
      input.latestUserMessage
    )
  ) {
    return false;
  }

  return input.context.assistantFormatPreference === 'paragraphs';
};

const buildCompactRewritePrompt = (
  input: GenerateSafeSpeakResponseInput,
  previousAnswer: string
): string =>
  [
    ...buildBasePromptSections(input, 'compact'),
    `Previous answer: ${previousAnswer}`,
    buildCompactRetryInstruction()
  ].join('\n');

const shouldUseProgressiveDisclosureRepair = (plan: SafeSpeakResponsePlan, violations: string[]): boolean =>
  plan.progressiveDisclosureStage === 'first_response' &&
  violations.some((violation) =>
    [
      'over_answering',
      'too_many_pathways',
      'premature_documentation',
      'premature_reporting',
      'premature_legal_detail',
      'too_many_next_steps'
    ].includes(violation)
  );

const buildProgressiveDisclosureRewritePrompt = (
  input: GenerateSafeSpeakResponseInput,
  previousAnswer: string
): string =>
  [
    ...buildBasePromptSections(input, 'compact'),
    `Previous answer: ${previousAnswer}`,
    'Rewrite using progressive disclosure. Keep only the immediate acknowledgement, the primary goal, and at most one next question.',
    'Remove deferred reporting, documentation, legal, service-list, or safety-plan detail unless the user explicitly asked for it.',
    'Keep the reply natural, calm, and specific. Do not output JSON.'
  ].join('\n');

const getResponseSystemPrompt = (
  input: GenerateSafeSpeakResponseInput,
  mode: GenerateSafeSpeakResponseInput['mode']
): string =>
  mode === 'natural'
    ? buildRawDevSystemPrompt()
    : getSafeSpeakSystemPrompt(input.context.detectedLanguage);

const callOpenAiPrompt = async (options: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
}): Promise<string> => {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model,
      input: [
        {
          role: 'system',
          content: options.systemPrompt
        },
        {
          role: 'user',
          content: options.userPrompt
        }
      ],
      temperature: options.temperature
    })
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI response request failed');
  }

  return normalizeAssistantContent(extractOutputText(await response.json()).trim());
};

const TECHNICAL_FALLBACK_MESSAGE =
  "I'm sorry, I couldn't generate a reliable response just now. Please try again.";

const minimalFallback = (
  intent: string,
  responseSource: 'guardrail_fallback' | 'model_empty_fallback' = 'guardrail_fallback'
): {
  assistantMessage: string;
  responseMode: 'emergency_minimum_fallback' | 'guardrail_fallback' | 'model_empty_fallback';
  responseSource: 'emergency_override' | 'guardrail_fallback' | 'model_empty_fallback';
} => {
  if (intent === 'safety_crisis') {
    return {
      assistantMessage:
        'If you are in immediate danger in Australia, call 000 now. If it is safe, you can contact 1800RESPECT.',
      responseMode: 'emergency_minimum_fallback',
      responseSource: 'emergency_override'
    };
  }

  return {
    assistantMessage: TECHNICAL_FALLBACK_MESSAGE,
    responseMode:
      responseSource === 'model_empty_fallback' ? 'model_empty_fallback' : 'guardrail_fallback',
    responseSource
  };
};

export const buildSafeSpeakFallbackResponse = (input: {
  intent: string;
  reason?: string;
  responseSource?: 'guardrail_fallback' | 'model_empty_fallback';
  ragStatus?: SafeSpeakRagStatus;
  consentSnapshot?: SafeSpeakModelContext['consentSnapshot'];
  intentConfidence?: 'high' | 'medium' | 'low';
  classifierSource?: 'rule' | 'model' | 'hybrid';
}): GenerateSafeSpeakResponseOutput => {
  const fallback = minimalFallback(input.intent, input.responseSource ?? 'guardrail_fallback');

  return {
    assistantMessage: fallback.assistantMessage,
    nextQuestion: '',
    readyForSubmission: false,
    confidence: 'medium',
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: [],
    showSources: false,
    sourceDisplayReason: 'hidden_support_reply',
    rag: {
      used: false,
      unavailable: input.ragStatus === 'required_but_no_sources_found',
      resultCount: 0
    },
    reviewStatus: input.intent,
    responseMode: fallback.responseMode,
    intent: input.intent,
    usedModelGeneration: false,
    guardrailStatus: 'fallback',
    fallbackReason: input.reason,
    staticTemplateUsed: false,
    consentSnapshot:
      input.consentSnapshot ??
      {
        store_local: false,
        cloud_sync: false,
        share_with_agencies: false,
        retain_evidence: false,
        process_with_ai: false,
        translate_content: false,
        warm_referral: false
      },
    intentConfidence: input.intentConfidence,
    classifierSource: input.classifierSource,
    responseSource: fallback.responseSource,
    model: env.OPENAI_MODEL,
    jurisdiction: 'AU',
    ragStatus: input.ragStatus ?? 'not_required',
    selectedResponseSource: fallback.responseSource
  };
};

const callOpenAI = async (
  input: GenerateSafeSpeakResponseInput,
  promptStyle: PromptStyle = 'default'
): Promise<string> => {
  const mode = input.mode ?? env.AI_RESPONSE_MODE;
  return callOpenAiPrompt({
    model: input.model ?? env.OPENAI_MODEL,
    systemPrompt: getResponseSystemPrompt(input, mode),
    userPrompt: buildUserPrompt(input, promptStyle),
    temperature: mode === 'natural' ? 0.7 : 0.4
  });
};

const rewriteCompactOpenAI = async (
  input: GenerateSafeSpeakResponseInput,
  previousAnswer: string
): Promise<string> => {
  const mode = input.mode ?? env.AI_RESPONSE_MODE;

  return callOpenAiPrompt({
    model: input.model ?? env.OPENAI_MODEL,
    systemPrompt: getResponseSystemPrompt(input, mode),
    userPrompt: buildCompactRewritePrompt(input, previousAnswer),
    temperature: mode === 'natural' ? 0.7 : 0.4
  });
};

const rewriteProgressiveDisclosureOpenAI = async (
  input: GenerateSafeSpeakResponseInput,
  previousAnswer: string
): Promise<string> => {
  const mode = input.mode ?? env.AI_RESPONSE_MODE;

  return callOpenAiPrompt({
    model: input.model ?? env.OPENAI_MODEL,
    systemPrompt: getResponseSystemPrompt(input, mode),
    userPrompt: buildProgressiveDisclosureRewritePrompt(input, previousAnswer),
    temperature: mode === 'natural' ? 0.7 : 0.4
  });
};

const attemptModelCallTwice = async (operation: () => Promise<string>): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('model_generation_failed');
};

const buildLengthTargets = (intent: string): { maxWords?: number; maxParagraphs?: number } => {
  const maxWordsByIntent: Partial<Record<string, number>> = {
    general_conversation: 45,
    meta_feedback: 50,
    format_preference_question: 45,
    format_preference_set: 35,
    physical_harm: 65,
    evidence_upload: 60,
    legal_boundary_specific_case: 70,
    legal_general_information: 110,
    scam_check: 70
  };
  const maxParagraphsByIntent: Partial<Record<string, number>> = {
    general_conversation: 3,
    meta_feedback: 3,
    format_preference_question: 3,
    format_preference_set: 2,
    physical_harm: 3,
    evidence_upload: 3,
    legal_boundary_specific_case: 3,
    legal_general_information: 4,
    scam_check: 3
  };

  return {
    maxWords: maxWordsByIntent[intent],
    maxParagraphs: maxParagraphsByIntent[intent]
  };
};

const trimResponseToSentenceBoundaries = (
  text: string,
  intent: string
): string => {
  const { maxWords, maxParagraphs } = buildLengthTargets(intent);
  if (!maxWords && !maxParagraphs) {
    return text.trim();
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const limitedParagraphs =
    maxParagraphs && paragraphs.length > maxParagraphs ? paragraphs.slice(0, maxParagraphs) : paragraphs;
  const sentences = limitedParagraphs
    .join('\n\n')
    .match(/[^.!?\n]+(?:[.!?]+|$)/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean);

  if (!sentences?.length) {
    return limitedParagraphs.join('\n\n').trim();
  }

  const selected: string[] = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;
    if (selected.length > 0 && maxWords && wordCount + sentenceWords > maxWords) {
      break;
    }
    selected.push(sentence);
    wordCount += sentenceWords;
    if (maxWords && wordCount >= maxWords) {
      break;
    }
  }

  return (selected.length > 0 ? selected.join(' ') : sentences[0]).trim();
};

export const generateSafeSpeakResponse = async (
  input: GenerateSafeSpeakResponseInput
): Promise<GenerateSafeSpeakResponseOutput> => {
  const mode = input.mode ?? env.AI_RESPONSE_MODE;
  const model = input.model ?? env.OPENAI_MODEL;
  const ragContext = input.ragContext ?? input.context.ragContext;
  const ragStatus = input.ragStatus ?? (ragContext.length > 0 ? 'retrieved' : 'not_required');
  const citations = ragContext.map((item) => ({
    title: item.sourceTitle,
    jurisdiction: item.jurisdiction,
    sourceType: item.sourceType,
    url: item.url,
    lastUpdated: item.lastUpdated
  }));
  const preferParagraphs = shouldPreferParagraphs(input);
  const retryPromptStyle: PromptStyle =
    input.intent === 'meta_feedback' ||
    input.intent === 'general_conversation' ||
    input.intent === 'format_preference_question' ||
    input.intent === 'format_preference_set'
      ? 'compact'
      : 'strict';
  const responseSourceBase: OpenAiResponseSource =
    mode === 'natural'
      ? 'raw_openai_model'
      : ragStatus === 'retrieved'
        ? 'openai_model_with_rag'
        : 'openai_model';

  if (!env.OPENAI_API_KEY) {
    const fallback = minimalFallback(input.intent);

    return {
      assistantMessage: fallback.assistantMessage,
      nextQuestion: '',
      readyForSubmission: false,
      confidence: 'medium',
      disclaimer: buildInformationOnlyDisclaimer(),
      citations: [],
      showSources: false,
      sourceDisplayReason: 'hidden_support_reply',
      rag: {
        used: ragContext.length > 0,
        unavailable: ragStatus === 'required_but_no_sources_found',
        resultCount: ragContext.length
      },
      reviewStatus: input.intent,
      responseMode: fallback.responseMode,
      intent: input.intent,
      usedModelGeneration: false,
      guardrailStatus: 'fallback',
      fallbackReason: 'missing_openai_key',
      staticTemplateUsed: false,
      consentSnapshot: input.context.consentSnapshot,
      intentConfidence: input.intentConfidence,
      classifierSource: input.classifierSource,
      responseSource: fallback.responseSource,
      model,
      jurisdiction: 'AU',
      ragStatus,
      selectedResponseSource: fallback.responseSource
    };
  }

  try {
    let assistantMessage = await attemptModelCallTwice(() =>
      callOpenAI({ ...input, mode, model, ragContext, ragStatus })
    );
    if (!assistantMessage.trim()) {
      assistantMessage = await attemptModelCallTwice(() =>
        callOpenAI({ ...input, mode, model, ragContext, ragStatus }, retryPromptStyle)
      );
    }

    if (!assistantMessage.trim()) {
      return buildSafeSpeakFallbackResponse({
        intent: input.intent,
        reason: 'empty_model_output',
        responseSource: 'model_empty_fallback',
        ragStatus,
        consentSnapshot: input.context.consentSnapshot,
        intentConfidence: input.intentConfidence,
        classifierSource: input.classifierSource
      });
    }

    if (mode === 'natural') {
      const responseSource: OpenAiResponseSource = 'raw_openai_model';

      return {
        assistantMessage: normalizeAssistantContent(assistantMessage),
        nextQuestion: '',
        readyForSubmission: false,
        confidence: 'medium',
        disclaimer: buildInformationOnlyDisclaimer(),
        citations,
        showSources: ragStatus === 'retrieved',
        sourceDisplayReason: ragStatus === 'retrieved' ? 'legal_lookup' : 'hidden_support_reply',
        rag: {
          used: ragContext.length > 0,
          unavailable: ragStatus === 'required_but_no_sources_found',
          resultCount: ragContext.length
        },
        reviewStatus: input.intent,
        responseMode: mode,
        intent: input.intent,
        usedModelGeneration: true,
        guardrailStatus: 'passed',
        fallbackReason: undefined,
        staticTemplateUsed: false,
        consentSnapshot: input.context.consentSnapshot,
        intentConfidence: input.intentConfidence,
        classifierSource: input.classifierSource,
        responseSource,
        model,
        jurisdiction: 'AU',
        ragStatus,
        selectedResponseSource: responseSource
      };
    }

    let guardrailStatus: GuardrailStatus = 'passed';
    let fallbackReason: string | undefined;
    let validation = validateSafeSpeakResponse({
      text: assistantMessage,
      intent: input.intent,
      jurisdiction: 'AU',
      allowMultipleQuestions: input.intent === 'safety_crisis',
      latestUserMessage: input.latestUserMessage,
      preferParagraphs,
      responsePlan: input.context.responsePlan
    });
    let { hard: hardViolations, soft: softViolations } = splitGuardrailViolations(
      validation.violations
    );

    if (hardViolations.length > 0) {
      assistantMessage = await attemptModelCallTwice(() =>
        callOpenAI({ ...input, mode, model, ragContext, ragStatus }, retryPromptStyle)
      );
      guardrailStatus = 'regenerated';
      validation = validateSafeSpeakResponse({
        text: assistantMessage,
        intent: input.intent,
        jurisdiction: 'AU',
        allowMultipleQuestions: input.intent === 'safety_crisis',
        latestUserMessage: input.latestUserMessage,
        preferParagraphs,
        responsePlan: input.context.responsePlan
      });
      ({ hard: hardViolations, soft: softViolations } = splitGuardrailViolations(validation.violations));
      if (hardViolations.length > 0) {
        return buildSafeSpeakFallbackResponse({
          intent: input.intent,
          reason: hardViolations.join(','),
          ragStatus,
          consentSnapshot: input.context.consentSnapshot,
          intentConfidence: input.intentConfidence,
          classifierSource: input.classifierSource
        });
      }
    }

    if (softViolations.length > 0) {
      const requiresStrictRepair =
        softViolations.includes('missing_legal_boundary_disclaimer') ||
        softViolations.includes('evidence_legal_strategy') ||
        softViolations.includes('checklist_heavy_for_intent');
      const requiresProgressiveDisclosureRepair = shouldUseProgressiveDisclosureRepair(
        input.context.responsePlan,
        softViolations
      );
      const requiresCompactRetry =
        softViolations.includes('too_long_for_intent') ||
        softViolations.includes('too_many_paragraphs_for_intent') ||
        softViolations.includes('too_many_questions') ||
        softViolations.includes('bullet_heavy_non_actionable');

      if (requiresStrictRepair || requiresCompactRetry || requiresProgressiveDisclosureRepair) {
        const rewrittenMessage = await attemptModelCallTwice(() =>
          requiresProgressiveDisclosureRepair
            ? rewriteProgressiveDisclosureOpenAI({ ...input, mode, model, ragContext, ragStatus }, assistantMessage)
            : requiresStrictRepair
            ? callOpenAI({ ...input, mode, model, ragContext, ragStatus }, 'strict')
            : rewriteCompactOpenAI({ ...input, mode, model, ragContext, ragStatus }, assistantMessage)
        );
        if (rewrittenMessage.trim()) {
          assistantMessage = rewrittenMessage;
          guardrailStatus = 'regenerated';
          fallbackReason = softViolations.includes('too_long_for_intent')
            ? 'too_long_for_intent'
            : softViolations[0];
          validation = validateSafeSpeakResponse({
            text: assistantMessage,
            intent: input.intent,
            jurisdiction: 'AU',
            allowMultipleQuestions: input.intent === 'safety_crisis',
            latestUserMessage: input.latestUserMessage,
            preferParagraphs,
            responsePlan: input.context.responsePlan
          });
          ({ hard: hardViolations, soft: softViolations } = splitGuardrailViolations(validation.violations));
        }
      }

      if (hardViolations.length > 0) {
        return buildSafeSpeakFallbackResponse({
          intent: input.intent,
          reason: hardViolations.join(','),
          ragStatus,
          consentSnapshot: input.context.consentSnapshot,
          intentConfidence: input.intentConfidence,
          classifierSource: input.classifierSource
        });
      }

      if (softViolations.includes('too_long_for_intent') || softViolations.includes('too_many_paragraphs_for_intent')) {
        assistantMessage = trimResponseToSentenceBoundaries(assistantMessage, input.intent);
        guardrailStatus = 'regenerated';
        fallbackReason = 'too_long_for_intent';
        validation = validateSafeSpeakResponse({
          text: assistantMessage,
          intent: input.intent,
          jurisdiction: 'AU',
          allowMultipleQuestions: input.intent === 'safety_crisis',
          latestUserMessage: input.latestUserMessage,
          preferParagraphs,
          responsePlan: input.context.responsePlan
        });
        ({ hard: hardViolations, soft: softViolations } = splitGuardrailViolations(validation.violations));
      }

      if (hardViolations.length > 0) {
        return buildSafeSpeakFallbackResponse({
          intent: input.intent,
          reason: hardViolations.join(','),
          ragStatus,
          consentSnapshot: input.context.consentSnapshot,
          intentConfidence: input.intentConfidence,
          classifierSource: input.classifierSource
        });
      }

      if (softViolations.length > 0 && !fallbackReason) {
        fallbackReason = softViolations[0];
      }
    }

    const responseSource: OpenAiResponseSource =
      guardrailStatus === 'regenerated' ? 'openai_model_regenerated' : responseSourceBase;

    return {
      assistantMessage: normalizeAssistantContent(assistantMessage),
      nextQuestion: '',
      readyForSubmission: false,
      confidence: 'medium',
      disclaimer: buildInformationOnlyDisclaimer(),
      citations,
      showSources: ragStatus === 'retrieved',
      sourceDisplayReason: ragStatus === 'retrieved' ? 'legal_lookup' : 'hidden_support_reply',
      rag: {
        used: ragContext.length > 0,
        unavailable: ragStatus === 'required_but_no_sources_found',
        resultCount: ragContext.length
      },
      reviewStatus: input.intent,
      responseMode: mode,
      intent: input.intent,
      usedModelGeneration: true,
      guardrailStatus,
      fallbackReason,
      staticTemplateUsed: false,
      consentSnapshot: input.context.consentSnapshot,
      intentConfidence: input.intentConfidence,
      classifierSource: input.classifierSource,
      responseSource,
      model,
      jurisdiction: 'AU',
      ragStatus,
      selectedResponseSource: responseSource
    };
  } catch (error) {
    return buildSafeSpeakFallbackResponse({
      intent: input.intent,
      reason: error instanceof Error ? error.message : 'model_generation_failed',
      ragStatus,
      consentSnapshot: input.context.consentSnapshot,
      intentConfidence: input.intentConfidence,
      classifierSource: input.classifierSource
    });
  }
};

export const generateSafeSpeakModelResponse = generateSafeSpeakResponse;
