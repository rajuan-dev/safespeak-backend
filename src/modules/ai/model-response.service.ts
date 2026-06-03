import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';

type GuardrailStatus = 'passed' | 'regenerated' | 'fallback';

type GenerateSafeSpeakModelResponseInput = {
  intent: string;
  userMessage: string;
  conversationSummary?: string;
  activeIncident?: Record<string, unknown>;
  consentSnapshot?: Record<string, unknown>;
  detectedLanguage?: string;
  ragContext?: string;
  safetyContext?: Record<string, unknown>;
  responseMode: string;
  previousAssistantMessage?: string;
};

type GenerateSafeSpeakModelResponseOutput = {
  assistantMessage: string;
  nextQuestion: string;
  readyForSubmission: false;
  confidence: 'medium';
  disclaimer: string;
  citations: [];
  showSources: false;
  sourceDisplayReason: 'hidden_support_reply';
  rag: {
    used: false;
    unavailable: false;
    resultCount: 0;
  };
  reviewStatus: string;
  responseMode: string;
  intent: string;
  usedModelGeneration: boolean;
  guardrailStatus: GuardrailStatus;
  fallbackReason?: string;
  staticTemplateUsed: boolean;
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

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

const buildSystemPrompt = (): string =>
  [
    'You are SafeSpeak Guide, a multilingual trauma-informed community safety navigation guide.',
    'You are not a lawyer, therapist, police officer, counsellor, or emergency service.',
    'Your job is to guide safely, explain pathways, reduce confusion, support documentation, and preserve user control.',
    'Respond naturally and contextually. Do not use static templates. Do not repeat the same phrase unless necessary.',
    'Use calm, plain language. Ask one question at a time.',
    'For legal/pathway topics: information only, not legal advice. Do not decide legality, liability, guilt, outcomes, or whether someone has a case.',
    'For evidence/upload topics: explain consent, storage, cloud sync, retention, and sharing only as relevant. Do not claim anything has been uploaded or shared.',
    'For safety crisis: prioritise 000 or emergency support.',
    'For meta-feedback or capability questions: answer the feedback directly and explain how SafeSpeak should behave.',
    'Avoid: you should, you must, this proves, you have a case, definitely illegal, generic repeated trauma templates.'
  ].join(' ');

const validateGuardrails = (assistantMessage: string, nextQuestion: string): string | null => {
  const combined = `${assistantMessage} ${nextQuestion}`.trim();

  if ((combined.match(/\?/g) ?? []).length > 1) {
    return 'too_many_questions';
  }

  if (
    /\b(you should sue|this is illegal|you have a case|definitely illegal|we reported|we shared|we sent)\b/i.test(
      combined
    )
  ) {
    return 'unsafe_claim';
  }

  return null;
};

export const buildMetaFeedbackFallbackResponse = (
  input: GenerateSafeSpeakModelResponseInput,
  reason?: string
): GenerateSafeSpeakModelResponseOutput => ({
  assistantMessage:
    'You are right — that sounded too scripted. SafeSpeak should respond to what you actually ask, while still keeping the safety, privacy, consent, and legal boundaries in place.',
  nextQuestion: 'Would you like to continue testing the chat behavior?',
  readyForSubmission: false,
  confidence: 'medium',
  disclaimer: 'This is information only, not legal advice.',
  citations: [],
  showSources: false,
  sourceDisplayReason: 'hidden_support_reply',
  rag: {
    used: false,
    unavailable: false,
    resultCount: 0
  },
  reviewStatus: input.intent,
  responseMode: input.responseMode,
  intent: input.intent,
  usedModelGeneration: false,
  guardrailStatus: 'fallback',
  fallbackReason: reason,
  staticTemplateUsed: false
});

const callOpenAIForMetaFeedback = async (
  input: GenerateSafeSpeakModelResponseInput,
  strictRetry = false
): Promise<string> => {
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
          content: buildSystemPrompt()
        },
        {
          role: 'user',
          content: [
            `Intent: ${input.intent}.`,
            `Response mode: ${input.responseMode}.`,
            `Language: ${input.detectedLanguage ?? 'en'}.`,
            input.conversationSummary ? `Conversation summary: ${input.conversationSummary}` : '',
            input.previousAssistantMessage
              ? `Previous assistant message: ${input.previousAssistantMessage}`
              : '',
            `Latest user message: ${input.userMessage}`,
            strictRetry
              ? 'Rewrite the reply more safely. Keep it concise, natural, and ask at most one question.'
              : 'Reply naturally, directly, and briefly. Acknowledge the feedback and explain that SafeSpeak should adapt to the actual question while keeping its safety boundaries.'
          ]
            .filter(Boolean)
            .join('\n')
        }
      ],
      temperature: 0.6
    })
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI response request failed');
  }

  return extractOutputText(await response.json()).trim();
};

export const generateSafeSpeakModelResponse = async (
  input: GenerateSafeSpeakModelResponseInput
): Promise<GenerateSafeSpeakModelResponseOutput> => {
  if (input.intent !== 'meta_feedback_or_capability_question') {
    return buildMetaFeedbackFallbackResponse(input, 'unsupported_intent');
  }

  if (!env.OPENAI_API_KEY) {
    return buildMetaFeedbackFallbackResponse(input, 'missing_openai_key');
  }

  try {
    let assistantMessage = await callOpenAIForMetaFeedback(input);
    let nextQuestion = '';
    let guardrailStatus: GuardrailStatus = 'passed';
    let guardrailFailure = validateGuardrails(assistantMessage, nextQuestion);

    if (guardrailFailure) {
      assistantMessage = await callOpenAIForMetaFeedback(input, true);
      guardrailStatus = 'regenerated';
      guardrailFailure = validateGuardrails(assistantMessage, nextQuestion);
    }

    if (guardrailFailure) {
      return buildMetaFeedbackFallbackResponse(input, guardrailFailure);
    }

    return {
      assistantMessage,
      nextQuestion,
      readyForSubmission: false,
      confidence: 'medium',
      disclaimer: 'This is information only, not legal advice.',
      citations: [],
      showSources: false,
      sourceDisplayReason: 'hidden_support_reply',
      rag: {
        used: false,
        unavailable: false,
        resultCount: 0
      },
      reviewStatus: input.intent,
      responseMode: input.responseMode,
      intent: input.intent,
      usedModelGeneration: true,
      guardrailStatus,
      staticTemplateUsed: false
    };
  } catch (error) {
    return buildMetaFeedbackFallbackResponse(
      input,
      error instanceof Error ? error.message : 'model_generation_failed'
    );
  }
};
