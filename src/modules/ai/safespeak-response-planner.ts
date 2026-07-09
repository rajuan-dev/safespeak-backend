import type { ConversationTurnPolicyDecision } from '@modules/conversation-flow/conversation-policy-engine';

import type { SafeSpeakIntent } from './intent-classifier';
import type { SafeSpeakSafetyContext } from './safespeak-context-builder';
import {
  detectProgressiveDisclosureStage,
  detectUserAdmitsHarmingOthers,
  detectUserRequestsBulletFormat,
  detectUserRequestsStepsFormat,
  type SafeSpeakProgressiveDisclosureStage
} from './safespeak-turn-signals';

export type SafeSpeakPrimaryGoal =
  | 'greet_or_capability'
  | 'answer_feedback'
  | 'set_format_preference'
  | 'immediate_safety_check'
  | 'support_then_immediate_safety_check'
  | 'prevent_further_harm_and_immediate_risk_check'
  | 'clarify_minimum_context'
  | 'emotional_support_and_user_control'
  | 'general_guidance'
  | 'evidence_privacy_guidance'
  | 'legal_boundary'
  | 'general_education'
  | 'scam_warning_signs'
  | 'crisis_response'
  | 'language_support';

export type SafeSpeakResponsePlan = {
  primaryGoal: SafeSpeakPrimaryGoal;
  allowedContent: string[];
  deferredContent: string[];
  maxDepth: 'shallow' | 'medium' | 'deep';
  maxQuestions: number;
  questionAllowed: boolean;
  preferredFormat: 'short_paragraphs' | 'bullets' | 'bullets_or_steps' | 'concise_sections';
  emergencyPriority: boolean;
  progressiveDisclosureStage: SafeSpeakProgressiveDisclosureStage;
  responseStrategy?: ConversationTurnPolicyDecision['responseStrategy'];
  groundedAnswerRequired?: boolean;
  disclaimerRequired?: boolean;
  sourcesVisible?: boolean;
  pathwayAllowed?: boolean;
  timelineCollectionAllowed?: boolean;
  humanReviewRequired?: boolean;
};

type BuildSafeSpeakResponsePlanInput = {
  intent: SafeSpeakIntent;
  latestUserMessage: string;
  conversationSummary?: string;
  activeIncidentSummary?: string;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
  turnPolicyDecision?: ConversationTurnPolicyDecision;
  safetyContext: Pick<
    SafeSpeakSafetyContext,
    'immediateDanger' | 'threatsPresent' | 'physicalHarm' | 'domesticFamilyViolence' | 'selfHarm' | 'childSafety'
  >;
};

const hasPattern = (value: string, pattern: RegExp): boolean => pattern.test(value);
const countWords = (value: string): number => value.split(/\s+/).filter(Boolean).length;

const DETAILED_HARM_OR_ACTION_PATTERN =
  /\b(hit|hurt|attack\w*|assault\w*|slapp\w*|kick\w*|threat\w*|weapon|knife|gun|kill\w*|blackmail\w*|follow\w*|grab\w*|pull\w*|touch\w*|share\w*|leak\w*|post\w*|send|sent|took|refus\w*|deni\w*|yell\w*|shout\w*|insult\w*|call(?:ed)? me|outside my house|still here|coming back)\b/i;
const VAGUE_SAFETY_DISCLOSURE_PATTERN =
  /\b(unsafe|not safe|feel unsafe|feel scared|scared|afraid|uneasy|uncomfortable|on edge)\b/i;

const resolvePreferredFormat = (input: {
  latestUserMessage: string;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
  fallback: SafeSpeakResponsePlan['preferredFormat'];
}): SafeSpeakResponsePlan['preferredFormat'] => {
  if (input.assistantFormatPreference === 'bullets') {
    return 'bullets';
  }

  if (detectUserRequestsBulletFormat(input.latestUserMessage)) {
    return 'bullets';
  }

  if (detectUserRequestsStepsFormat(input.latestUserMessage)) {
    return 'bullets_or_steps';
  }

  return input.fallback;
};

const applyTurnPolicy = (
  plan: Omit<
    SafeSpeakResponsePlan,
    | 'responseStrategy'
    | 'groundedAnswerRequired'
    | 'disclaimerRequired'
    | 'sourcesVisible'
    | 'pathwayAllowed'
    | 'timelineCollectionAllowed'
    | 'humanReviewRequired'
  >,
  turnPolicyDecision?: ConversationTurnPolicyDecision
): SafeSpeakResponsePlan => ({
  ...plan,
  maxQuestions: turnPolicyDecision
    ? Math.min(plan.maxQuestions, turnPolicyDecision.maxQuestions)
    : plan.maxQuestions,
  questionAllowed: turnPolicyDecision ? turnPolicyDecision.questionAllowed : plan.questionAllowed,
  responseStrategy: turnPolicyDecision?.responseStrategy,
  groundedAnswerRequired: turnPolicyDecision?.groundedAnswerRequired,
  disclaimerRequired: turnPolicyDecision?.disclaimerRequired,
  sourcesVisible: turnPolicyDecision?.sourcesVisible,
  pathwayAllowed: turnPolicyDecision?.pathwayAllowed,
  timelineCollectionAllowed: turnPolicyDecision?.timelineCollectionAllowed,
  humanReviewRequired: turnPolicyDecision?.humanReviewRequired
});

export const buildSafeSpeakResponsePlan = (
  input: BuildSafeSpeakResponsePlanInput
): SafeSpeakResponsePlan => {
  const latestUserMessage = input.latestUserMessage.trim();
  const latestWordCount = countWords(latestUserMessage);
  const stage = detectProgressiveDisclosureStage(latestUserMessage);
  const emergencyPriority =
    input.safetyContext.immediateDanger ||
    input.safetyContext.threatsPresent ||
    input.safetyContext.selfHarm ||
    input.safetyContext.childSafety;
  const shortVagueSafetyDisclosure =
    latestWordCount > 0 &&
    latestWordCount <= 8 &&
    VAGUE_SAFETY_DISCLOSURE_PATTERN.test(latestUserMessage) &&
    !DETAILED_HARM_OR_ACTION_PATTERN.test(latestUserMessage);

  if (input.intent === 'general_conversation') {
    return applyTurnPolicy(
      {
        primaryGoal: 'greet_or_capability',
        allowedContent: ['one warm direct sentence', 'one simple invitation to share'],
        deferredContent: [
          'capability lists',
          'categories or example answers',
          'multiple questions',
          'detailed pathway lists',
          'legal detail',
          'documentation detail'
        ],
        maxDepth: 'shallow',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: 'short_paragraphs',
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'meta_feedback') {
    return applyTurnPolicy(
      {
        primaryGoal: 'answer_feedback',
        allowedContent: ['brief acknowledgement', 'direct answer to the feedback'],
        deferredContent: ['incident pathways', 'legal detail', 'service lists'],
        maxDepth: 'shallow',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: 'short_paragraphs',
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'format_preference_question' || input.intent === 'format_preference_set') {
    return applyTurnPolicy(
      {
        primaryGoal: 'set_format_preference',
        allowedContent: ['direct answer about format choice'],
        deferredContent: ['incident pathways', 'legal detail'],
        maxDepth: 'shallow',
        maxQuestions: 0,
        questionAllowed: false,
        preferredFormat: 'short_paragraphs',
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'language_or_translation') {
    return applyTurnPolicy(
      {
        primaryGoal: 'language_support',
        allowedContent: ['direct language support answer'],
        deferredContent: ['incident pathways unless asked'],
        maxDepth: 'shallow',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: 'short_paragraphs',
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'safety_crisis') {
    return applyTurnPolicy(
      {
        primaryGoal: 'crisis_response',
        allowedContent: [
          'immediate safety direction',
          '000 if urgent risk in Australia',
          'one brief safety question'
        ],
        deferredContent: ['documentation checklist', 'reporting detail', 'legal detail'],
        maxDepth: 'shallow',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: 'short_paragraphs',
        emergencyPriority: true,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (
    input.intent === 'physical_harm' ||
    input.intent === 'incident_disclosure' ||
    input.intent === 'unknown'
  ) {
    const userAdmitsHarmingOthers = detectUserAdmitsHarmingOthers(latestUserMessage);
    const familyHomeContext = hasPattern(
      latestUserMessage,
      /\b(brother|sister|mother|father|partner|husband|wife|family|home|house)\b/i
    );
    const publicContext = hasPattern(latestUserMessage, /\b(street|bus|train|school|shop|public|outside)\b/i);
    const allowedContent = [
      'two or three short sentences of grounded emotional support',
      'affirmation that the user did not deserve the harm',
      'permission to pause or share only what feels safe',
      'one safety question if immediate risk is possible, otherwise one optional choice-based question'
    ];

    if (emergencyPriority || input.safetyContext.physicalHarm) {
      allowedContent.push(
        '000 only if immediate danger, serious injury, or urgent threat may be present'
      );
    }

    if (familyHomeContext || input.safetyContext.domesticFamilyViolence) {
      allowedContent.push(
        'brief 1800RESPECT mention only if home or family safety may be relevant'
      );
    }

    if (publicContext) {
      allowedContent.push('at most one broad may-based pathway mention if useful');
    }

    if (userAdmitsHarmingOthers) {
      return applyTurnPolicy(
        {
          primaryGoal: 'prevent_further_harm_and_immediate_risk_check',
          allowedContent: [
            'brief plain acknowledgement of the user admitting they hurt someone',
            'clear focus on preventing further harm right now',
            'one direct immediate-risk question about whether they might hurt someone again or whether they can move away'
          ],
          deferredContent: [
            'victim-style reassurance',
            'generic empathy template',
            'legal classification',
            'service list',
            'documentation checklist',
            'relationship analysis'
          ],
          maxDepth: 'shallow',
          maxQuestions: 1,
          questionAllowed: true,
          preferredFormat: 'short_paragraphs',
          emergencyPriority: true,
          progressiveDisclosureStage: stage
        },
        input.turnPolicyDecision
      );
    }

    if (!emergencyPriority && shortVagueSafetyDisclosure) {
      return applyTurnPolicy(
        {
          primaryGoal: 'clarify_minimum_context',
          allowedContent: [
            'one short acknowledgement tied only to the stated safety concern',
            'one minimal context-shaped question tied to the user’s exact wording, setting, or clue',
            'do not default to an immediate-danger question unless the latest message suggests present urgent risk',
            'do not assume an actor, relationship, motive, emotion, or harm details that were not stated'
          ],
          deferredContent: [
            'generic empathy template',
            'affirmation that the user did not deserve the harm',
            'permission to pause or share only what feels safe',
            'relationship analysis',
            'detailed safety plan',
            'service list'
          ],
          maxDepth: 'shallow',
          maxQuestions: 1,
          questionAllowed: true,
          preferredFormat: 'short_paragraphs',
          emergencyPriority: false,
          progressiveDisclosureStage: stage
        },
        input.turnPolicyDecision
      );
    }

    return applyTurnPolicy(
      {
        primaryGoal: emergencyPriority
          ? 'support_then_immediate_safety_check'
          : 'emotional_support_and_user_control',
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
        questionAllowed: true,
        preferredFormat: 'short_paragraphs',
        emergencyPriority,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'evidence_upload') {
    const wantsDocumentation =
      stage === 'user_requests_documentation' ||
      /\b(how can i|how do i|organi[sz]e|document|label|sort)\b/i.test(latestUserMessage);

    return applyTurnPolicy(
      {
        primaryGoal: wantsDocumentation ? 'evidence_privacy_guidance' : 'general_guidance',
        allowedContent: wantsDocumentation
          ? [
              'concise practical organization steps',
              'privacy and consent reminder',
              'no false upload/share claim'
            ]
          : ['short low-pressure acknowledgement', 'brief evidence/privacy answer only'],
        deferredContent: [
          'legal strategy',
          'reporting pathway',
          'police or agency steps unless asked'
        ],
        maxDepth: wantsDocumentation ? 'medium' : 'shallow',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: resolvePreferredFormat({
          latestUserMessage,
          assistantFormatPreference: input.assistantFormatPreference,
          fallback: wantsDocumentation ? 'bullets_or_steps' : 'short_paragraphs'
        }),
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'legal_boundary_specific_case') {
    return applyTurnPolicy(
      {
        primaryGoal: 'legal_boundary',
        allowedContent: [
          'information only',
          'cannot decide legality or whether the user can sue',
          'one minimal state or context question'
        ],
        deferredContent: [
          'detailed legal explanation unless asked',
          'pathway list unless sources are available'
        ],
        maxDepth: 'shallow',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: 'short_paragraphs',
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'legal_general_information' || input.intent === 'rag_pathway_question') {
    return applyTurnPolicy(
      {
        primaryGoal:
          input.intent === 'rag_pathway_question' ? 'general_guidance' : 'general_education',
        allowedContent:
          input.intent === 'rag_pathway_question'
            ? ['reporting or pathway options because the user asked']
            : ['general explanation', 'information-only framing'],
        deferredContent: ['case-specific legal conclusion', 'service lists unless asked'],
        maxDepth: 'medium',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: resolvePreferredFormat({
          latestUserMessage,
          assistantFormatPreference: input.assistantFormatPreference,
          fallback:
            input.intent === 'rag_pathway_question' ? 'bullets_or_steps' : 'concise_sections'
        }),
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  if (input.intent === 'scam_check') {
    return applyTurnPolicy(
      {
        primaryGoal: 'scam_warning_signs',
        allowedContent: ['red flags', 'safe verification steps'],
        deferredContent: ['reporting pathways unless asked', 'legal detail'],
        maxDepth: 'medium',
        maxQuestions: 1,
        questionAllowed: true,
        preferredFormat: resolvePreferredFormat({
          latestUserMessage,
          assistantFormatPreference: input.assistantFormatPreference,
          fallback: 'bullets'
        }),
        emergencyPriority: false,
        progressiveDisclosureStage: stage
      },
      input.turnPolicyDecision
    );
  }

  return applyTurnPolicy(
    {
      primaryGoal: 'general_guidance',
      allowedContent: ['direct answer to the user’s immediate ask'],
      deferredContent: ['extra pathways not yet requested'],
      maxDepth: 'shallow',
      maxQuestions: 1,
      questionAllowed: true,
      preferredFormat: 'short_paragraphs',
      emergencyPriority: false,
      progressiveDisclosureStage: stage
    },
    input.turnPolicyDecision
  );
};
