import type { SafeSpeakIntent } from './intent-classifier';
import type { SafeSpeakSafetyContext } from './safespeak-context-builder';

export type SafeSpeakPrimaryGoal =
  | 'greet_or_capability'
  | 'answer_feedback'
  | 'set_format_preference'
  | 'immediate_safety_check'
  | 'clarify_minimum_context'
  | 'general_guidance'
  | 'evidence_privacy_guidance'
  | 'legal_boundary'
  | 'general_education'
  | 'scam_warning_signs'
  | 'crisis_response'
  | 'language_support';

export type SafeSpeakProgressiveDisclosureStage =
  | 'first_response'
  | 'user_requests_options'
  | 'user_requests_documentation'
  | 'user_requests_reporting'
  | 'user_requests_legal_info'
  | 'report_building_mode';

export type SafeSpeakResponsePlan = {
  primaryGoal: SafeSpeakPrimaryGoal;
  allowedContent: string[];
  deferredContent: string[];
  maxDepth: 'shallow' | 'medium' | 'deep';
  maxQuestions: number;
  preferredFormat: 'short_paragraphs' | 'bullets' | 'bullets_or_steps' | 'concise_sections';
  emergencyPriority: boolean;
  progressiveDisclosureStage: SafeSpeakProgressiveDisclosureStage;
};

type BuildSafeSpeakResponsePlanInput = {
  intent: SafeSpeakIntent;
  latestUserMessage: string;
  conversationSummary?: string;
  activeIncidentSummary?: string;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
  safetyContext: Pick<
    SafeSpeakSafetyContext,
    'immediateDanger' | 'threatsPresent' | 'physicalHarm' | 'domesticFamilyViolence' | 'selfHarm' | 'childSafety'
  >;
};

const hasPattern = (value: string, pattern: RegExp): boolean => pattern.test(value);

const detectStage = (message: string): SafeSpeakProgressiveDisclosureStage => {
  if (hasPattern(message, /\b(report(ing)? options?|who do i report to|where can i report|which agency|police report)\b/i)) {
    return 'user_requests_reporting';
  }

  if (
    hasPattern(
      message,
      /\b(how can i|how do i|help me|can you help me|please help me)\b.*\b(document|documentation|organi[sz]e|timeline|evidence|photos?|screenshots?|record)\b/i
    ) ||
    hasPattern(message, /\b(document it|organise it|organize it|help me document)\b/i)
  ) {
    return 'user_requests_documentation';
  }

  if (hasPattern(message, /\b(illegal|legal|law|sue|rights|case)\b/i)) {
    return 'user_requests_legal_info';
  }

  if (hasPattern(message, /\b(options?|what can i do|next steps?|what now)\b/i)) {
    return 'user_requests_options';
  }

  if (hasPattern(message, /\b(build|draft|prepare)\b.*\b(report|timeline|statement)\b/i)) {
    return 'report_building_mode';
  }

  return 'first_response';
};

const resolvePreferredFormat = (input: {
  latestUserMessage: string;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
  fallback: SafeSpeakResponsePlan['preferredFormat'];
}): SafeSpeakResponsePlan['preferredFormat'] => {
  if (input.assistantFormatPreference === 'bullets') {
    return 'bullets';
  }

  if (hasPattern(input.latestUserMessage, /\b(bullet points?|red flags?|warning signs?)\b/i)) {
    return 'bullets';
  }

  if (hasPattern(input.latestUserMessage, /\b(steps?|organi[sz]e|document|timeline)\b/i)) {
    return 'bullets_or_steps';
  }

  return input.fallback;
};

export const buildSafeSpeakResponsePlan = (
  input: BuildSafeSpeakResponsePlanInput
): SafeSpeakResponsePlan => {
  const latestUserMessage = input.latestUserMessage.trim();
  const stage = detectStage(latestUserMessage);
  const emergencyPriority =
    input.safetyContext.immediateDanger ||
    input.safetyContext.threatsPresent ||
    input.safetyContext.selfHarm ||
    input.safetyContext.childSafety;

  if (input.intent === 'general_conversation') {
    return {
      primaryGoal: 'greet_or_capability',
      allowedContent: ['brief direct answer', 'short overview of support areas'],
      deferredContent: ['detailed pathway lists', 'legal detail', 'documentation detail'],
      maxDepth: 'shallow',
      maxQuestions: 1,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'meta_feedback') {
    return {
      primaryGoal: 'answer_feedback',
      allowedContent: ['brief acknowledgement', 'direct answer to the feedback'],
      deferredContent: ['incident pathways', 'legal detail', 'service lists'],
      maxDepth: 'shallow',
      maxQuestions: 1,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'format_preference_question' || input.intent === 'format_preference_set') {
    return {
      primaryGoal: 'set_format_preference',
      allowedContent: ['direct answer about format choice'],
      deferredContent: ['incident pathways', 'legal detail'],
      maxDepth: 'shallow',
      maxQuestions: 0,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'language_or_translation') {
    return {
      primaryGoal: 'language_support',
      allowedContent: ['direct language support answer'],
      deferredContent: ['incident pathways unless asked'],
      maxDepth: 'shallow',
      maxQuestions: 1,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'safety_crisis') {
    return {
      primaryGoal: 'crisis_response',
      allowedContent: ['immediate safety direction', '000 if urgent risk in Australia', 'one brief safety question'],
      deferredContent: ['documentation checklist', 'reporting detail', 'legal detail'],
      maxDepth: 'shallow',
      maxQuestions: 1,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: true,
      progressiveDisclosureStage: stage
    };
  }

  if (
    input.intent === 'physical_harm' ||
    input.intent === 'incident_disclosure' ||
    input.intent === 'unknown'
  ) {
    const familyHomeContext = hasPattern(latestUserMessage, /\b(brother|sister|mother|father|partner|husband|wife|family|home|house)\b/i);
    const publicContext = hasPattern(latestUserMessage, /\b(street|bus|train|school|shop|public|outside)\b/i);
    const allowedContent = ['brief acknowledgement', 'one safety or context question'];

    if (emergencyPriority || input.safetyContext.physicalHarm) {
      allowedContent.push('000 only if immediate danger, serious injury, or urgent threat may be present');
    }

    if (familyHomeContext || input.safetyContext.domesticFamilyViolence) {
      allowedContent.push('brief 1800RESPECT mention only if home or family safety may be relevant');
    }

    if (publicContext) {
      allowedContent.push('at most one broad may-based pathway mention if useful');
    }

    return {
      primaryGoal: emergencyPriority ? 'immediate_safety_check' : 'clarify_minimum_context',
      allowedContent,
      deferredContent: [
        'documentation checklist',
        'reporting options',
        'legal classification',
        'detailed safety plan',
        'boundary-setting scripts',
        'service list'
      ],
      maxDepth: 'shallow',
      maxQuestions: 1,
      preferredFormat: 'short_paragraphs',
      emergencyPriority,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'evidence_upload') {
    const wantsDocumentation = stage === 'user_requests_documentation' || hasPattern(latestUserMessage, /\b(how can i|how do i|organi[sz]e|document|label|sort)\b/i);

    return {
      primaryGoal: wantsDocumentation ? 'evidence_privacy_guidance' : 'general_guidance',
      allowedContent: wantsDocumentation
        ? ['concise practical organization steps', 'privacy and consent reminder', 'no false upload/share claim']
        : ['short low-pressure acknowledgement', 'brief evidence/privacy answer only'],
      deferredContent: ['legal strategy', 'reporting pathway', 'police or agency steps unless asked'],
      maxDepth: wantsDocumentation ? 'medium' : 'shallow',
      maxQuestions: 1,
      preferredFormat: resolvePreferredFormat({
        latestUserMessage,
        assistantFormatPreference: input.assistantFormatPreference,
        fallback: wantsDocumentation ? 'bullets_or_steps' : 'short_paragraphs'
      }),
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'legal_boundary_specific_case') {
    return {
      primaryGoal: 'legal_boundary',
      allowedContent: ['information only', 'cannot decide legality or whether the user can sue', 'one minimal state or context question'],
      deferredContent: ['detailed legal explanation unless asked', 'pathway list unless sources are available'],
      maxDepth: 'shallow',
      maxQuestions: 1,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'legal_general_information' || input.intent === 'rag_pathway_question') {
    return {
      primaryGoal: input.intent === 'rag_pathway_question' ? 'general_guidance' : 'general_education',
      allowedContent:
        input.intent === 'rag_pathway_question'
          ? ['reporting or pathway options because the user asked']
          : ['general explanation', 'information-only framing'],
      deferredContent: ['case-specific legal conclusion', 'service lists unless asked'],
      maxDepth: 'medium',
      maxQuestions: 1,
      preferredFormat: resolvePreferredFormat({
        latestUserMessage,
        assistantFormatPreference: input.assistantFormatPreference,
        fallback: input.intent === 'rag_pathway_question' ? 'bullets_or_steps' : 'concise_sections'
      }),
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  if (input.intent === 'scam_check') {
    return {
      primaryGoal: 'scam_warning_signs',
      allowedContent: ['red flags', 'safe verification steps'],
      deferredContent: ['reporting pathways unless asked', 'legal detail'],
      maxDepth: 'medium',
      maxQuestions: 1,
      preferredFormat: resolvePreferredFormat({
        latestUserMessage,
        assistantFormatPreference: input.assistantFormatPreference,
        fallback: 'bullets'
      }),
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    };
  }

  return {
    primaryGoal: 'general_guidance',
    allowedContent: ['direct answer to the user’s immediate ask'],
    deferredContent: ['extra pathways not yet requested'],
    maxDepth: 'shallow',
    maxQuestions: 1,
    preferredFormat: 'short_paragraphs',
    emergencyPriority: false,
    progressiveDisclosureStage: stage
  };
};
