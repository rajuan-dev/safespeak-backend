import type { ConsentFlags } from '@modules/consent/consent.types';

import type {
  IntentConfidence,
  SafeSpeakIntent,
  SafeSpeakIntentClassification
} from './intent-classifier';

export type SafeSpeakRagSnippet = {
  sourceTitle: string;
  jurisdiction: string;
  sourceType: string;
  url?: string;
  lastUpdated?: string;
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
  jurisdiction: 'AU';
  latestUserMessage: string;
  detectedLanguage: string;
  intent: SafeSpeakIntent;
  assistantFormatPreference?: 'paragraphs' | 'bullets' | 'mix';
  conversationSummary: string;
  activeIncidentSummary: string;
  consentSnapshot: SafeSpeakConsentContext;
  safetyContext: SafeSpeakSafetyContext;
  ragContext: SafeSpeakRagSnippet[];
  userSelectedTopic?: string;
  constraints: string[];
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

const buildIntentSpecificConstraints = (
  intent: SafeSpeakIntent,
  input: SafeSpeakContextBuilderInput
): string[] => {
  switch (intent) {
    case 'general_conversation':
      return [
        'General conversation: answer naturally and briefly.',
        'Do not force triage.',
        'Do not use trauma-informed harm language unless the user described harm.'
      ];
    case 'meta_feedback':
      return [
        'Meta-feedback: acknowledge the feedback naturally and briefly.',
        'Do not trigger triage.',
        'Do not sound defensive or technical.'
      ];
    case 'physical_harm':
      return [
        'Physical harm: keep the response short.',
        'Mention 000 only if immediate danger, serious injury, or urgent risk is relevant in the context.',
        'Ask only one safety question.',
        'Do not give a long checklist unless the user asked for steps.'
      ];
    case 'evidence_upload':
      return [
        'Evidence upload: keep the response short.',
        'Do not imply anything was automatically uploaded, saved, shared, sent, retained, or synced.',
        'Mention consent only when relevant to the user question or current consent state.',
        'Avoid legal-strategy wording.',
        'Ask only one question.'
      ];
    case 'legal_boundary':
      return [
        'Legal boundary: do not answer legality directly.',
        'Do not decide criminality, liability, or whether the user can sue.',
        'Do not say "you can sue", "suing is an option", or "criminal matter" as a conclusion.',
        'Include the concept that SafeSpeak provides information only, not legal advice.',
        input.ragContext?.length
          ? 'Use the available RAG context to explain information pathways cautiously.'
          : 'If jurisdiction or legal context is missing, ask one minimal jurisdiction or context question.'
      ];
    default:
      return [];
  }
};

export const buildSafeSpeakContext = (
  input: SafeSpeakContextBuilderInput
): SafeSpeakModelContext => {
  const ragContext = input.ragContext ?? [];
  const intent = input.intentClassification.intent;

  return {
    app: 'SafeSpeak',
    jurisdiction: 'AU',
    latestUserMessage: input.latestUserMessage,
    detectedLanguage: input.detectedLanguage,
    intent,
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
    constraints: [
      'Respond naturally to the latest user message.',
      'Use short natural paragraphs for normal conversation, meta-feedback, language requests, and simple answers.',
      'Use bullet points only when there are multiple concrete safety steps, evidence steps, or comparison options. Do not default to bullets.',
      'Do not claim any upload, sharing, saving, syncing, or agency contact already happened unless confirmed by backend action.',
      'Use Australian emergency guidance only: 000.',
      'Ask at most one user-facing question.',
      'For evidence messages, keep the answer short, low-pressure, consent-aware, and documentation-focused.',
      'Avoid legal-strategy phrases like hard to dispute, prove your case, build your case, strong evidence, or use this against them.',
      ...buildIntentSpecificConstraints(intent, { ...input, ragContext })
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
