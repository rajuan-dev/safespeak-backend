import type { ConsentFlags } from '@modules/consent/consent.types';

import type {
  IntentConfidence,
  SafeSpeakIntent,
  SafeSpeakIntentClassification
} from './intent-classifier';
import {
  getSafeSpeakIntentPolicy,
  type SafeSpeakIntentPolicy
} from './safespeak-intent-policy';
import {
  buildSafeSpeakResponsePlan,
  type SafeSpeakResponsePlan
} from './safespeak-response-planner';

export type SafeSpeakRagSnippet = {
  sourceTitle: string;
  sourceAuthority?: string;
  jurisdiction: string;
  stateOrTerritory?: string;
  legalDomain?: string;
  pathwayCategory?: string;
  sourceType: string;
  url?: string;
  lastUpdated?: string;
  sectionNumber?: string;
  sectionTitle?: string;
  relevantSnippet: string;
};

export type SafeSpeakRagStatus = 'not_required' | 'retrieved' | 'required_but_no_sources_found';

export type SafeSpeakSafetyContext = {
  latestTurnRiskLevel: string;
  activeIncidentRiskLevel: string;
  sessionHistoricalMaxRiskLevel: string;
  immediateDanger: boolean;
  threatsPresent: boolean;
  physicalHarm: boolean;
  domesticFamilyViolence: boolean;
  selfHarm: boolean;
  childSafety: boolean;
  recommendedEmergencyNumber: '000';
  relevantSupport: string[];
};

export type SafeSpeakConsentContext = Pick<
  ConsentFlags,
  | 'store_local'
  | 'cloud_sync'
  | 'share_with_agencies'
  | 'retain_evidence'
  | 'process_with_ai'
  | 'translate_content'
  | 'warm_referral'
>;

export type SafeSpeakModelContext = {
  app: 'SafeSpeak';
  persona: 'SafeSpeak Guide';
  jurisdiction: 'AU';
  latestUserMessage: string;
  detectedLanguage: string;
  intent: SafeSpeakIntent;
  intentPolicy: SafeSpeakIntentPolicy;
  ragStatus: SafeSpeakRagStatus;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
  conversationSummary: string;
  activeIncidentSummary: string;
  consentSnapshot: SafeSpeakConsentContext;
  safetyContext: SafeSpeakSafetyContext;
  ragContext: SafeSpeakRagSnippet[];
  userSelectedTopic?: string;
  constraints: string[];
  responsePlan: SafeSpeakResponsePlan;
};

export type SafeSpeakContextBuilderInput = {
  latestUserMessage: string;
  detectedLanguage: string;
  intentClassification: SafeSpeakIntentClassification;
  conversationSummary?: string;
  activeIncidentSummary?: string;
  consentSnapshot?: Partial<SafeSpeakConsentContext>;
  safetyContext: Omit<SafeSpeakSafetyContext, 'recommendedEmergencyNumber' | 'relevantSupport'> & {
    relevantSupport?: string[];
  };
  ragContext?: SafeSpeakRagSnippet[];
  ragStatus?: SafeSpeakRagStatus;
  userSelectedTopic?: string;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
};

const summarize = (value?: string, fallback = 'None recorded.'): string => {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 400 ? `${normalized.slice(0, 397)}...` : normalized;
};

const toConsentContext = (
  input?: Partial<SafeSpeakConsentContext>
): SafeSpeakConsentContext => ({
  store_local: Boolean(input?.store_local),
  cloud_sync: Boolean(input?.cloud_sync),
  share_with_agencies: Boolean(input?.share_with_agencies),
  retain_evidence: Boolean(input?.retain_evidence),
  process_with_ai: Boolean(input?.process_with_ai),
  translate_content: Boolean(input?.translate_content),
  warm_referral: Boolean(input?.warm_referral)
});

export const buildSafeSpeakContext = (
  input: SafeSpeakContextBuilderInput
): SafeSpeakModelContext => {
  const ragContext = input.ragContext ?? [];
  const intent = input.intentClassification.intent;
  const ragStatus = input.ragStatus ?? (ragContext.length > 0 ? 'retrieved' : 'not_required');
  const intentPolicy = getSafeSpeakIntentPolicy(intent);
  const responsePlan = buildSafeSpeakResponsePlan({
    intent,
    latestUserMessage: input.latestUserMessage,
    conversationSummary: input.conversationSummary,
    activeIncidentSummary: input.activeIncidentSummary,
    assistantFormatPreference: input.assistantFormatPreference,
    safetyContext: {
      immediateDanger: input.safetyContext.immediateDanger,
      threatsPresent: input.safetyContext.threatsPresent,
      physicalHarm: input.safetyContext.physicalHarm,
      domesticFamilyViolence: input.safetyContext.domesticFamilyViolence,
      selfHarm: input.safetyContext.selfHarm,
      childSafety: input.safetyContext.childSafety
    }
  });

  return {
    app: 'SafeSpeak',
    persona: 'SafeSpeak Guide',
    jurisdiction: 'AU',
    latestUserMessage: input.latestUserMessage,
    detectedLanguage: input.detectedLanguage,
    intent,
    intentPolicy,
    ragStatus,
    assistantFormatPreference: input.assistantFormatPreference,
    conversationSummary: summarize(input.conversationSummary),
    activeIncidentSummary: summarize(input.activeIncidentSummary),
    consentSnapshot: toConsentContext(input.consentSnapshot),
    safetyContext: {
      ...input.safetyContext,
      recommendedEmergencyNumber: '000',
      relevantSupport:
        input.safetyContext.relevantSupport?.length
          ? input.safetyContext.relevantSupport
          : input.safetyContext.domesticFamilyViolence
            ? ['1800RESPECT']
            : []
    },
    ragContext,
    userSelectedTopic: input.userSelectedTopic,
    responsePlan,
    constraints: [
      'Respond naturally to the latest user message.',
      'Use reasoning to infer what the user is actually asking and answer directly.',
      'Be natural, specific, context-aware, and not scripted.',
      'Preserve user control and give options, not orders.',
      'Choose the format that best helps: paragraphs for conversation, bullets for options, steps, red flags, or organized guidance.',
      'Follow the response plan. Focus on the primary goal only and do not include deferred content unless the user asked for it.',
      'Choose the next best response, not every possible response. If multiple pathways may apply, mention only the most immediate or useful one and defer the rest.',
      'Do not claim any upload, sharing, saving, syncing, or agency contact already happened unless confirmed by backend action.',
      'Use Australian emergency guidance only: 000.',
      'Ask at most one user-facing question.',
      'Keep legal content information-only and never invent citations.',
      ...intentPolicy.guidance
    ]
  };
};

export const buildActiveIncidentSummary = (facts: Record<string, unknown>): string => {
  const summaryParts = [
    typeof facts.whatHappened === 'string' ? `What happened: ${facts.whatHappened}` : '',
    typeof facts.whereHappened === 'string' ? `Where: ${facts.whereHappened}` : '',
    typeof facts.whenHappened === 'string' ? `When: ${facts.whenHappened}` : '',
    typeof facts.peopleInvolved === 'string' ? `People: ${facts.peopleInvolved}` : '',
    typeof facts.safetyConcerns === 'string' ? `Safety: ${facts.safetyConcerns}` : '',
    typeof facts.evidenceMentioned === 'string' ? `Evidence: ${facts.evidenceMentioned}` : ''
  ]
    .filter(Boolean)
    .join('; ');

  return summarize(summaryParts);
};

export const buildClassifierMetadata = (
  classification: SafeSpeakIntentClassification
): {
  intent: SafeSpeakIntent;
  intentConfidence: IntentConfidence;
  classifierSource: SafeSpeakIntentClassification['classifierSource'];
  matchedSignals: string[];
} => ({
  intent: classification.intent,
  intentConfidence: classification.confidence,
  classifierSource: classification.classifierSource,
  matchedSignals: classification.matchedSignals
});
