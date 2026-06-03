import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';

import {
  buildGuardrailRevisionInstruction,
  buildInformationOnlyDisclaimer,
  buildRawDevSystemPrompt,
  getSafeSpeakSystemPrompt,
  validateSafeSpeakResponse
} from './ai-guardrails';
import type {
  SafeSpeakModelContext,
  SafeSpeakRagSnippet,
  SafeSpeakRagStatus
} from './safespeak-context-builder';

type GuardrailStatus = 'passed' | 'regenerated' | 'fallback';

export type GenerateSafeSpeakResponseInput = {
  mode?: 'safespeak_model' | 'raw_dev';
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
    | 'raw_dev'
    | 'emergency_minimum_fallback'
    | 'guardrail_fallback';
  intent: string;
  usedModelGeneration: boolean;
  guardrailStatus: GuardrailStatus;
  fallbackReason?: string;
  staticTemplateUsed: false;
  consentSnapshot: SafeSpeakModelContext['consentSnapshot'];
  intentConfidence?: 'high' | 'medium' | 'low';
  classifierSource?: 'rule' | 'model' | 'hybrid';
  responseSource:
    | 'openai_model'
    | 'openai_model_with_rag'
    | 'raw_openai_model'
    | 'emergency_override'
    | 'guardrail_fallback';
  model: string;
  jurisdiction: 'AU';
  ragStatus: SafeSpeakRagStatus;
  selectedResponseSource:
    | 'openai_model'
    | 'openai_model_with_rag'
    | 'raw_openai_model'
    | 'emergency_override'
    | 'guardrail_fallback';
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
            `${index + 1}. title=${item.sourceTitle}; jurisdiction=${item.jurisdiction}; sourceType=${item.sourceType}; url=${
              item.url ?? 'n/a'
            }; lastUpdated=${item.lastUpdated ?? 'n/a'}; snippet=${item.relevantSnippet}`
        )
      ].join('\n');

const buildUserPrompt = (input: GenerateSafeSpeakResponseInput, strictRetry = false): string =>
  [
    `Intent: ${input.intent}`,
    `Latest user message: ${input.latestUserMessage}`,
    `SafeSpeak context JSON: ${JSON.stringify(input.context)}`,
    `RAG status: ${input.ragStatus ?? 'not_required'}`,
    buildRagPromptSection(input.ragContext ?? input.context.ragContext),
    strictRetry
      ? buildGuardrailRevisionInstruction()
      : 'Write the final assistant reply naturally. Do not output JSON.'
  ].join('\n');

const minimalFallback = (intent: string): { assistantMessage: string; responseMode: 'emergency_minimum_fallback' | 'guardrail_fallback'; responseSource: 'emergency_override' | 'guardrail_fallback' } => {
  if (intent === 'safety_crisis') {
    return {
      assistantMessage: 'If you are in immediate danger in Australia, call 000 now.',
      responseMode: 'emergency_minimum_fallback',
      responseSource: 'emergency_override'
    };
  }

  return {
    assistantMessage:
      'I can help, but I need to keep this safety-focused and information-only. Could you rephrase what you want help with?',
    responseMode: 'guardrail_fallback',
    responseSource: 'guardrail_fallback'
  };
};

export const buildSafeSpeakFallbackResponse = (input: {
  intent: string;
  reason?: string;
  ragStatus?: SafeSpeakRagStatus;
  consentSnapshot?: SafeSpeakModelContext['consentSnapshot'];
  intentConfidence?: 'high' | 'medium' | 'low';
  classifierSource?: 'rule' | 'model' | 'hybrid';
}): GenerateSafeSpeakResponseOutput => {
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

const callOpenAI = async (input: GenerateSafeSpeakResponseInput, strictRetry = false): Promise<string> => {
  const mode = input.mode ?? env.AI_RESPONSE_MODE;
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: input.model ?? env.OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content:
            mode === 'raw_dev'
              ? buildRawDevSystemPrompt()
              : getSafeSpeakSystemPrompt(input.context.detectedLanguage)
        },
        {
          role: 'user',
          content: buildUserPrompt(input, strictRetry)
        }
      ],
      temperature: mode === 'raw_dev' ? 0.7 : 0.4
    })
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI response request failed');
  }

  return normalizeAssistantContent(extractOutputText(await response.json()).trim());
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
    let assistantMessage = await callOpenAI({ ...input, mode, model, ragContext, ragStatus });
    let guardrailStatus: GuardrailStatus = 'passed';
    let validation = validateSafeSpeakResponse({
      text: assistantMessage,
      jurisdiction: 'AU',
      allowMultipleQuestions: input.intent === 'safety_crisis',
      latestUserMessage: input.latestUserMessage
    });

    if (!validation.passed) {
      assistantMessage = await callOpenAI(
        { ...input, mode, model, ragContext, ragStatus },
        true
      );
      guardrailStatus = 'regenerated';
      validation = validateSafeSpeakResponse({
        text: assistantMessage,
        jurisdiction: 'AU',
        allowMultipleQuestions: input.intent === 'safety_crisis',
        latestUserMessage: input.latestUserMessage
      });
    }

    if (!validation.passed) {
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
        fallbackReason: validation.violations.join(','),
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

    const responseSource =
      mode === 'raw_dev'
        ? 'raw_openai_model'
        : ragStatus === 'retrieved'
          ? 'openai_model_with_rag'
          : 'openai_model';

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
      fallbackReason: error instanceof Error ? error.message : 'model_generation_failed',
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
};

export const generateSafeSpeakModelResponse = generateSafeSpeakResponse;
