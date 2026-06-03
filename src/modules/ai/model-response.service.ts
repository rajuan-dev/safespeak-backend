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
  intentConfidence?: 'high' | 'medium' | 'low';
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
  consentSnapshot?: Record<string, unknown>;
  intentConfidence?: 'high' | 'medium' | 'low';
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

const callOpenAIForConversation = async (
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
          content: [
            'You are a helpful assistant.',
            'Reply directly to the latest user message in natural plain text.',
            'Do not wrap the reply in JSON, labels, or templates.',
            'Use the user language when it is clear from the message.',
            strictRetry ? 'Rewrite the reply more safely and concisely.' : 'Keep the reply natural and concise.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            input.conversationSummary ? `Conversation summary: ${input.conversationSummary}` : '',
            input.previousAssistantMessage
              ? `Previous assistant message: ${input.previousAssistantMessage}`
              : '',
            input.intent ? `Detected intent: ${input.intent}.` : '',
            input.responseMode ? `Conversation mode: ${input.responseMode}.` : '',
            input.detectedLanguage ? `Detected language: ${input.detectedLanguage}.` : '',
            input.consentSnapshot
              ? `Consent snapshot: ${JSON.stringify(input.consentSnapshot)}`
              : '',
            `Latest user message: ${input.userMessage}`,
            strictRetry
              ? 'Rewrite the reply more safely. Keep it concise and natural.'
              : 'Reply directly to the latest user message.'
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
  if (!env.OPENAI_API_KEY) {
    return buildMetaFeedbackFallbackResponse(input, 'missing_openai_key');
  }

  try {
    let assistantMessage = await callOpenAIForConversation(input);
    let nextQuestion = '';
    let guardrailStatus: GuardrailStatus = 'passed';
    let guardrailFailure = validateGuardrails(assistantMessage, nextQuestion);

    if (guardrailFailure) {
      assistantMessage = await callOpenAIForConversation(input, true);
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
      staticTemplateUsed: false,
      consentSnapshot: input.consentSnapshot,
      intentConfidence: input.intentConfidence
    };
  } catch (error) {
    return buildMetaFeedbackFallbackResponse(
      input,
      error instanceof Error ? error.message : 'model_generation_failed'
    );
  }
};
