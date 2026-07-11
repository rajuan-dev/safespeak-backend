import { env } from '@config/env';

import { callAiAgentText } from './ai-agent.client';

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
type RepairType = 'none' | 'local_fix' | 'model_regeneration' | 'fallback';
type OpenAiResponseSource =
  | 'openai_model'
  | 'openai_model_with_rag'
  | 'openai_model_regenerated'
  | 'openai_model_local_fix'
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
    sourceId?: string;
    title: string;
    legislationName?: string;
    publisher?: string;
    jurisdiction: string;
    sourceType: string;
    url?: string;
    lastUpdated?: string;
    sectionRef?: string;
    sectionTitle?: string;
    page?: number;
    pageStart?: number;
    pageEnd?: number;
    versionDate?: string;
    commencementDate?: string;
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
  staticTemplateUsed: boolean;
  consentSnapshot: SafeSpeakModelContext['consentSnapshot'];
  intentConfidence?: 'high' | 'medium' | 'low';
  classifierSource?: 'rule' | 'model' | 'hybrid';
  responseSource: OpenAiResponseSource;
  model: string;
  jurisdiction: 'AU';
  ragStatus: SafeSpeakRagStatus;
  selectedResponseSource: OpenAiResponseSource;
  repairType?: RepairType;
};

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
            }; pageStart=${item.pageStart ?? 'n/a'}; pageEnd=${item.pageEnd ?? 'n/a'}; versionDate=${
              item.versionDate ?? 'n/a'
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
    sections.push(
      'For factual claims, use only the RAG snippets above. Do not use general knowledge or infer missing facts. Preserve exact names, dates, numbers, and legal wording. If the snippets do not contain the answer, say it was not found in the available approved data.'
    );
  }

  sections.push('Reply directly to the latest user message in plain text.');

  return sections.join('\n');
};

const buildPromptContextSummary = (input: GenerateSafeSpeakResponseInput): string =>
  JSON.stringify({
    primaryGoal: input.context.responsePlan?.primaryGoal,
    allowedContent: input.context.responsePlan?.allowedContent,
    deferredContent: input.context.responsePlan?.deferredContent,
    maxQuestions: input.context.responsePlan?.maxQuestions,
    questionAllowed: input.context.responsePlan?.questionAllowed,
    progressiveDisclosureStage: input.context.responsePlan?.progressiveDisclosureStage,
    responseStrategy: input.context.turnPolicyDecision?.responseStrategy,
    groundedAnswerRequired: input.context.turnPolicyDecision?.groundedAnswerRequired,
    disclaimerRequired: input.context.turnPolicyDecision?.disclaimerRequired,
    pathwayAllowed: input.context.turnPolicyDecision?.pathwayAllowed,
    timelineCollectionAllowed: input.context.turnPolicyDecision?.timelineCollectionAllowed,
    humanReviewRequired: input.context.turnPolicyDecision?.humanReviewRequired
  });

const buildBasePromptSections = (
  input: GenerateSafeSpeakResponseInput,
  promptStyle: PromptStyle = 'default'
): string[] => {
  const basePrompt =
    promptStyle === 'compact'
      ? [
          `Intent: ${input.intent}`,
          `Persona: ${input.context.persona}`,
          `Latest user message: ${input.latestUserMessage}`,
          `Detected language: ${input.context.detectedLanguage}`,
          `Format preference: ${input.context.assistantFormatPreference ?? 'paragraphs'}`,
          `Prompt context: ${buildPromptContextSummary(input)}`,
          `Key constraints: ${(input.context.constraints ?? []).join(' | ')}`,
          `RAG status: ${input.ragStatus ?? 'not_required'}`,
          buildRagPromptSection(input.ragContext ?? input.context.ragContext)
        ]
      : [
          `Intent: ${input.intent}`,
          `Persona: ${input.context.persona}`,
          `Latest user message: ${input.latestUserMessage}`,
          `Assistant format preference: ${input.context.assistantFormatPreference ?? 'paragraphs'}`,
          `Prompt context: ${buildPromptContextSummary(input)}`,
          `Conversation summary: ${input.context.conversationSummary || 'No prior context.'}`,
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
            ? `Write one brief SafeSpeak reply in plain text. ${STYLE_CONTRACT_LINES.join(' ')} Do not output JSON.`
            : `Write the final SafeSpeak reply in plain text. ${STYLE_CONTRACT_LINES.join(' ')} Do not output JSON.`
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
    'Apply PRINCIPLE 1 — HUMAN FIRST: the rewrite must first feel human before it feels informational. It should feel calm, safe, structured, culturally aware, and non-judgmental. It must not feel robotic, investigative, overly legal, or interrogative.',
    'Apply PRINCIPLE 2 — TRIAGE BEFORE DATA COLLECTION: understand first, route second, and collect only the smallest targeted detail later. Remove giant forms, multi-question intake, premature evidence collection, and premature reporting details.',
    'Apply PRINCIPLE 3 — MINIMUM NECESSARY INFORMATION: keep only information needed for triage, the selected pathway, or the selected agency. Remove unnecessary sensitive questions, agency-specific fields when no agency is selected, and report-style collection when the user only needs support or options.',
    'Apply PRINCIPLE 4 — AI SHOULD UNDERSTAND, NOT DECIDE: interpret, extract supported signals, and identify possibilities only. Remove legal conclusions, eligibility decisions, agency-routing decisions, escalation decisions, safety override claims, or final outcome claims made by the model.',
    'Apply PRINCIPLE 5 — PATHWAYS OVER LAWS: keep legislation internal and rewrite user-facing text into plain-language options, guidance, support, and next steps. Remove legislation lists, legal jargon, legal analysis, Act sections, offence tests, penalties, and formal legal categories unless the user explicitly asked for them.',
    'Apply PRINCIPLE 6 — AUTHORITATIVE RAG ONLY: keep legal, rights, pathway, reporting, agency, safety-service, privacy, online-safety, discrimination, DV, workplace, migration, child-protection, surveillance, evidence, scam, and consumer-protection claims grounded only in approved RAG. Remove unsupported legal facts, unsupported contact details, invented citations, stale or mismatched jurisdiction claims, and source claims not present in retrieved snippets.',
    'Write like a calm, caring person who is paying close attention.',
    ...STYLE_CONTRACT_LINES,
    'Avoid canned sympathy, repeated openings, or generic filler.',
    'Start with a brief acknowledgement that feels supportive and emotionally attuned, but only to the level supported by the user’s words.',
    'Ground the rewrite only in facts explicitly present in the latest message and conversation summary. Do not invent an emotion, impact, mistreatment, danger, or desired outcome.',
    'Do not rename the user’s situation with blame-heavy language such as "trouble", "your fault", "mess", or "guilty" unless the user used that framing for themselves.',
    'If the latest user message already contains a concrete setting, actor, or harm clue, replace generic follow-up questions with one situation-specific question tied to that clue.',
    'Do not default to a stock immediate-danger question when the latest message only gives a vague safety concern without present-urgency signals. Ask one question shaped by the user’s exact words instead.',
    'Do not keep asking questions only to identify the exact legal category or which law may have been broken. If there is enough context for a cautious best-fit explanation, move forward with that.',
    'If the user admitted harming someone, do not answer as though they were the victim. Acknowledge the admission plainly, focus on preventing further harm, and ask one direct immediate-risk question.',
    'Continue the conversation from the newest detail. Do not reuse the wording, opening phrase, reassurance, or question pattern of a prior assistant turn.',
    ...(input.latestUserMessage.trim().split(/\s+/).length <= 8
      ? [
          'The latest message contains very little information. Write one natural sentence of at most 14 words that acknowledges only the stated context and asks at most one open question tied to the user’s wording. Do not use a fixed fallback question.'
        ]
      : []),
    buildCompactRetryInstruction()
  ].join('\n');

const shouldUseProgressiveDisclosureRepair = (plan: SafeSpeakResponsePlan, violations: string[]): boolean =>
  plan.progressiveDisclosureStage === 'first_response' &&
  violations.some((violation) =>
    [
      'over_answering',
      'unsupported_low_detail_expansion',
      'generic_follow_up_for_supported_context',
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
    'Write like a calm, caring person who is paying close attention.',
    ...STYLE_CONTRACT_LINES,
    'Do not sound over-explained.',
    'Keep the opening warm and supportive, but do not claim feelings or facts the user did not give you.',
    'Ground the rewrite only in facts explicitly present in the latest message and conversation summary. Do not invent an emotion, impact, mistreatment, danger, actor, relationship, or desired outcome.',
    'If the latest user message contains only a vague safety concern without present-urgency signals, do not default to a stock immediate-danger question.',
    'Ask one dynamic question shaped by the user’s exact wording, setting, or clue.',
    'Do not reuse the same reassurance template or question pattern from the previous answer.',
    'If the message is short, keep the rewrite short.',
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
  return normalizeAssistantContent(
    await callAiAgentText({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      model: options.model,
      temperature: options.temperature
    })
  );
};

const TECHNICAL_FALLBACK_MESSAGE =
  "I'm sorry, I couldn't generate a reliable response just now. Please try again.";

const STYLE_CONTRACT_LINES = [
  'Sound like one calm, thoughtful person, not a script.',
  'Let the reply feel warm and supportive without becoming dramatic or generic.',
  'Stay close to the user\'s exact words and level of detail.',
  'If you reflect feeling, keep it tentative and grounded in what the user actually said.',
  'If you ask a question, ask only one and make it fit what they actually said.'
] as const;

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

const keepFirstQuestionOnly = (text: string): string => {
  const normalized = normalizeAssistantContent(text).trim();
  if (!normalized) {
    return normalized;
  }
  const firstQuestionIndex = normalized.indexOf('?');
  if (firstQuestionIndex < 0) {
    return normalized;
  }
  const prefix = normalized.slice(0, firstQuestionIndex + 1);
  const suffix = normalized
    .slice(firstQuestionIndex + 1)
    .replace(/\?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return suffix ? `${prefix} ${suffix}` : prefix;
};

const softenBlameHeavyReframing = (text: string): string =>
  normalizeAssistantContent(text)
    .replace(/\bgot you in trouble\b/gi, 'has been happening')
    .replace(/\bin trouble\b/gi, 'going on')
    .replace(/\byour fault\b/gi, 'what happened')
    .replace(/\bmess you made\b/gi, 'situation')
    .replace(/\bguilty\b/gi, 'responsible');

const applyLocalSoftViolationFixes = (input: {
  text: string;
  softViolations: string[];
}): { text: string; applied: boolean; reason?: string } => {
  let nextText = input.text;
  let applied = false;
  let reason: string | undefined;

  if (input.softViolations.includes('too_many_questions')) {
    const trimmed = keepFirstQuestionOnly(nextText);
    if (trimmed !== nextText) {
      nextText = trimmed;
      applied = true;
      reason ??= 'too_many_questions';
    }
  }

  if (input.softViolations.includes('unsupported_blame_reframing')) {
    const softened = softenBlameHeavyReframing(nextText);
    if (softened !== nextText) {
      nextText = softened;
      applied = true;
      reason ??= 'unsupported_blame_reframing';
    }
  }

  return { text: nextText, applied, reason };
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
    temperature: input.ragStatus === 'retrieved' ? 0.2 : mode === 'natural' ? 0.7 : 0.4
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
    sourceId: item.sourceId,
    title: item.sourceTitle,
    legislationName: item.legislationName,
    publisher: item.publisher ?? item.sourceAuthority,
    jurisdiction: item.jurisdiction,
    sourceType: item.sourceType,
    url: item.url,
    lastUpdated: item.lastUpdated,
    sectionRef: item.sectionNumber,
    sectionTitle: item.sectionTitle,
    page: item.page,
    pageStart: item.pageStart,
    pageEnd: item.pageEnd,
    versionDate: item.versionDate,
    commencementDate: item.commencementDate
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
        selectedResponseSource: responseSource,
        repairType: 'none'
      };
    }

    let guardrailStatus: GuardrailStatus = 'passed';
    let repairType: RepairType = 'none';
    let fallbackReason: string | undefined;
    let validation = validateSafeSpeakResponse({
      text: assistantMessage,
      intent: input.intent,
      jurisdiction: 'AU',
      allowMultipleQuestions: input.intent === 'safety_crisis',
      latestUserMessage: input.latestUserMessage,
      conversationSummary: input.context.conversationSummary,
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
      repairType = 'model_regeneration';
      validation = validateSafeSpeakResponse({
        text: assistantMessage,
        intent: input.intent,
        jurisdiction: 'AU',
        allowMultipleQuestions: input.intent === 'safety_crisis',
        latestUserMessage: input.latestUserMessage,
        conversationSummary: input.context.conversationSummary,
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
      const localFix = applyLocalSoftViolationFixes({
        text: assistantMessage,
        softViolations
      });
      if (localFix.applied) {
        assistantMessage = localFix.text;
        guardrailStatus = 'regenerated';
        repairType = 'local_fix';
        fallbackReason = localFix.reason;
        validation = validateSafeSpeakResponse({
          text: assistantMessage,
          intent: input.intent,
          jurisdiction: 'AU',
          allowMultipleQuestions: input.intent === 'safety_crisis',
          latestUserMessage: input.latestUserMessage,
          conversationSummary: input.context.conversationSummary,
          preferParagraphs,
          responsePlan: input.context.responsePlan
        });
        ({ hard: hardViolations, soft: softViolations } = splitGuardrailViolations(validation.violations));
      }

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
        softViolations.includes('unsupported_low_detail_expansion') ||
        softViolations.includes('unsupported_blame_reframing') ||
        softViolations.includes('repetitive_conversation_opening') ||
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
          repairType = 'model_regeneration';
          fallbackReason = softViolations.includes('too_long_for_intent')
            ? 'too_long_for_intent'
            : softViolations[0];
          validation = validateSafeSpeakResponse({
            text: assistantMessage,
            intent: input.intent,
            jurisdiction: 'AU',
            allowMultipleQuestions: input.intent === 'safety_crisis',
            latestUserMessage: input.latestUserMessage,
            conversationSummary: input.context.conversationSummary,
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
        repairType = 'local_fix';
        fallbackReason = 'too_long_for_intent';
        validation = validateSafeSpeakResponse({
          text: assistantMessage,
          intent: input.intent,
          jurisdiction: 'AU',
          allowMultipleQuestions: input.intent === 'safety_crisis',
          latestUserMessage: input.latestUserMessage,
          conversationSummary: input.context.conversationSummary,
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
      repairType === 'model_regeneration'
        ? 'openai_model_regenerated'
        : repairType === 'local_fix'
          ? 'openai_model_local_fix'
          : responseSourceBase;

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
      selectedResponseSource: responseSource,
      repairType
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
