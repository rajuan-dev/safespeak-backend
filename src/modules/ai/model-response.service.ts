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
  selectedResponseSource?: 'openai_model' | 'dynamic_fallback';
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

const buildDynamicFallbackMessage = (
  input: GenerateSafeSpeakModelResponseInput
): Pick<GenerateSafeSpeakModelResponseOutput, 'assistantMessage' | 'nextQuestion'> => {
  if (
    input.intent === 'safety_physical_harm' ||
    input.intent === 'physical_harm' ||
    input.responseMode === 'emergency_safety'
  ) {
    return {
      assistantMessage:
        'I am sorry that happened. If you are in immediate danger or need urgent help, call 000 now. If you are safe right now, move to a safer place if you can and write down what happened while it is fresh.',
      nextQuestion: 'Are you safe at the moment?'
    };
  }

  if (input.intent === 'meta_feedback_or_capability_question' || input.responseMode === 'meta_feedback') {
    return {
      assistantMessage:
        'That reply did not match your question well enough. Ask again and I will answer it more directly.',
      nextQuestion: ''
    };
  }

  if (input.intent === 'evidence_upload_intent' || input.responseMode === 'evidence_consent') {
    return {
      assistantMessage:
        'You can choose whether to upload anything. Uploading does not automatically send or share evidence.',
      nextQuestion: 'Would you like to keep it local for now?'
    };
  }

  return {
    assistantMessage: 'I can help with that. Tell me the next detail you want to focus on.',
    nextQuestion: ''
  };
};

export const buildMetaFeedbackFallbackResponse = (
  input: GenerateSafeSpeakModelResponseInput,
  reason?: string
): GenerateSafeSpeakModelResponseOutput => ({
  ...buildDynamicFallbackMessage(input),
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
  staticTemplateUsed: false,
  consentSnapshot: input.consentSnapshot,
  intentConfidence: input.intentConfidence,
  selectedResponseSource: 'dynamic_fallback'
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
      intentConfidence: input.intentConfidence,
      selectedResponseSource: 'openai_model'
    };
  } catch (error) {
    return buildMetaFeedbackFallbackResponse(
      input,
      error instanceof Error ? error.message : 'model_generation_failed'
    );
  }
};
