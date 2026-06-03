import type { ConsentFlags } from '@modules/consent/consent.types';

export type EvidenceConsentSnapshot = Pick<
  ConsentFlags,
  'store_local' | 'cloud_sync' | 'share_with_agencies' | 'retain_evidence' | 'process_with_ai'
>;

export type EvidenceResponseVariant =
  | 'local_only'
  | 'repeat_follow_up'
  | 'high_risk_context'
  | 'cloud_sync_on'
  | 'agency_sharing_on'
  | 'ai_analysis_question'
  | 'generic_evidence';

export type EvidenceComposerInput = {
  userMessage: string;
  consent: ConsentFlags;
  activeIncident?: {
    matchedFacts?: string[];
    platforms?: string[];
    domesticViolence?: boolean;
    coerciveControl?: boolean;
    threatPresent?: boolean;
    immediateDanger?: boolean;
  };
  latestTurnRiskLevel?: string;
  activeIncidentRiskLevel?: string;
  detectedLanguage?: string;
  conversationState?: {
    priorEvidenceUploadTurns?: number;
    latestAssistantMessage?: string;
  };
};

type EvidenceComposerOutput = {
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
  reviewStatus: 'evidence_upload_intent';
  intent: 'evidence_upload_intent';
  responseMode: 'evidence_consent';
  subIntent?: 'ai_analysis_question';
  intentConfidence: 'high';
  responseVariant: EvidenceResponseVariant;
  consentSnapshot: EvidenceConsentSnapshot;
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const hashString = (value: string): number => {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
};

const pickFrom = (options: string[], seed: string): string =>
  options[hashString(seed) % options.length] ?? options[0] ?? '';

const toConsentSnapshot = (consent: ConsentFlags): EvidenceConsentSnapshot => ({
  store_local: Boolean(consent.store_local),
  cloud_sync: Boolean(consent.cloud_sync),
  share_with_agencies: Boolean(consent.share_with_agencies),
  retain_evidence: Boolean(consent.retain_evidence),
  process_with_ai: Boolean(consent.process_with_ai)
});

const getEvidenceLabel = (message: string): string => {
  const normalized = message.toLowerCase();

  if (/\bscreenshot|screen shot\b/.test(normalized)) {
    return 'screenshots';
  }

  if (/\bphoto|image|picture\b/.test(normalized)) {
    return 'photos';
  }

  if (/\bdocument|documents|paperwork\b/.test(normalized)) {
    return 'documents';
  }

  if (/\bproof\b/.test(normalized)) {
    return 'proof';
  }

  if (/\bevidence\b/.test(normalized)) {
    return 'evidence';
  }

  return 'files';
};

const usesPluralPronoun = (evidenceLabel: string): boolean =>
  ['screenshots', 'photos', 'documents', 'files'].includes(evidenceLabel);

const getObjectPronoun = (evidenceLabel: string): 'them' | 'it' =>
  usesPluralPronoun(evidenceLabel) ? 'them' : 'it';

const getSubjectPronoun = (evidenceLabel: string): 'they' | 'it' =>
  usesPluralPronoun(evidenceLabel) ? 'they' : 'it';

const asksAboutAiAnalysis = (message: string): boolean => {
  const normalized = collapseWhitespace(message).toLowerCase();

  return [
    /\bwill ai analy[sz]e\b/,
    /\bwill you analy[sz]e\b/,
    /\bdoes ai check\b/,
    /\bwill safespeak analy[sz]e\b/,
    /\bif i upload (it|them|this).+will ai\b/,
    /\bai read\b/,
    /\bai process\b/,
    /\b(ai|artificial intelligence)\b.*\b(analy[sz]e|process|read|look at|review|scan|check)\b/,
    /\b(analy[sz]e|process|read|look at|review|scan|check)\b.*\b(ai|artificial intelligence|safespeak)\b/
  ].some((pattern) => pattern.test(normalized));
};

const hasHighRiskContext = (input: EvidenceComposerInput): boolean => {
  const combinedRisk = [
    input.latestTurnRiskLevel,
    input.activeIncidentRiskLevel,
    input.activeIncident?.immediateDanger ? 'immediate' : '',
    input.activeIncident?.threatPresent ? 'high' : '',
    input.activeIncident?.domesticViolence ? 'high' : '',
    input.activeIncident?.coerciveControl ? 'high' : '',
    ...(input.activeIncident?.matchedFacts ?? [])
  ]
    .join(' ')
    .toLowerCase();

  return /urgent|immediate|high|threat|kill|weapon|danger|coercive|domestic/i.test(combinedRisk);
};

const getResponseVariant = (input: EvidenceComposerInput, consent: EvidenceConsentSnapshot) => {
  if (asksAboutAiAnalysis(input.userMessage)) {
    return 'ai_analysis_question' as const;
  }

  if (hasHighRiskContext(input)) {
    return 'high_risk_context' as const;
  }

  if ((input.conversationState?.priorEvidenceUploadTurns ?? 0) > 0) {
    return 'repeat_follow_up' as const;
  }

  if (consent.cloud_sync) {
    return 'cloud_sync_on' as const;
  }

  if (consent.share_with_agencies) {
    return 'agency_sharing_on' as const;
  }

  if (!consent.cloud_sync && consent.store_local) {
    return 'local_only' as const;
  }

  return 'generic_evidence' as const;
};

const getDirectAnswer = (
  input: EvidenceComposerInput,
  evidenceLabel: string,
  variant: EvidenceResponseVariant
): string => {
  const objectPronoun = getObjectPronoun(evidenceLabel);
  const aiQuestion = asksAboutAiAnalysis(input.userMessage);
  const seed = `${variant}|${evidenceLabel}|${collapseWhitespace(input.userMessage).toLowerCase()}`;

  if (aiQuestion) {
    return input.consent.process_with_ai
      ? pickFrom(
          [
            `Only if you choose to use an AI feature for ${objectPronoun}.`,
            `Not by default. SafeSpeak should only analyse ${objectPronoun} if you choose an AI step.`,
            `Only if you choose that. Uploading ${objectPronoun} does not automatically trigger AI analysis.`
          ],
          seed
        )
      : pickFrom(
          [
            `Not unless you turn that on. Your current settings do not allow AI processing for ${objectPronoun}.`,
            `No, not with your current settings. AI processing is off unless you enable it later.`,
            `Not right now. SafeSpeak should not use AI on ${objectPronoun} unless you enable that first.`
          ],
          seed
        );
  }

  return pickFrom(
    [
      `Yes, you can upload ${evidenceLabel} if you feel comfortable.`,
      `Yes. You can attach ${objectPronoun} and stay in control of what happens next.`,
      `You can add ${objectPronoun} if it feels safe to do so.`,
      `Yes, you can upload that ${evidenceLabel === 'evidence' ? 'evidence' : evidenceLabel} if you choose.`
    ],
    seed
  );
};

const getSharingSentence = (
  evidenceLabel: string,
  consent: EvidenceConsentSnapshot,
  variant: EvidenceResponseVariant,
  userMessage: string
): string => {
  const objectPronoun = getObjectPronoun(evidenceLabel);
  const subjectPronoun = getSubjectPronoun(evidenceLabel);
  const seed = `${variant}|sharing|${userMessage}`;

  if (consent.share_with_agencies) {
    return pickFrom(
      [
        `Agency sharing is enabled in your settings, but SafeSpeak should still ask before sending anything to a specific agency.`,
        `Your settings allow agency sharing, but nothing should be sent to a specific agency without a clear confirmation step.`,
        `Agency sharing is on, but uploading ${objectPronoun} still does not send ${objectPronoun} anywhere automatically.`
      ],
      seed
    );
  }

  return pickFrom(
    [
      `${subjectPronoun.charAt(0).toUpperCase() + subjectPronoun.slice(1)} will not be sent to any agency automatically.`,
      `Nothing should be shared automatically.`,
      `Uploading ${objectPronoun} does not submit a report or send anything to an agency.`
    ],
    seed
  );
};

const getStorageSentence = (
  evidenceLabel: string,
  consent: EvidenceConsentSnapshot,
  variant: EvidenceResponseVariant,
  userMessage: string
): string => {
  const objectPronoun = getObjectPronoun(evidenceLabel);
  const subjectPronoun = getSubjectPronoun(evidenceLabel);
  const seed = `${variant}|storage|${userMessage}`;

  if (consent.cloud_sync) {
    return pickFrom(
      [
        `Your settings show cloud sync is on, so ${objectPronoun} may sync according to your consent settings.`,
        `Cloud sync is on in your settings, so SafeSpeak may sync ${objectPronoun} within that consented setup.`,
        `Because cloud sync is on, ${objectPronoun} may be synced as part of your chosen settings.`
      ],
      seed
    );
  }

  if (consent.store_local) {
    return pickFrom(
      [
        `Cloud sync is off, so ${subjectPronoun} should stay local unless you choose otherwise.`,
        `Since cloud sync is off, the local Evidence Vault is the safer default for ${objectPronoun}.`,
        `Your settings show cloud sync is off, so ${subjectPronoun} should stay local unless you decide to sync or share ${objectPronoun} later.`
      ],
      seed
    );
  }

  return pickFrom(
    [
      `Cloud sync is off, and local storage is also off in your current settings, so SafeSpeak should not keep ${objectPronoun} unless you change that first.`,
      `Right now cloud sync is off, and local storage is not enabled for ${objectPronoun}, so nothing should be kept unless you choose a storage setting first.`
    ],
    seed
  );
};

const getRetentionSentence = (
  evidenceLabel: string,
  consent: EvidenceConsentSnapshot,
  variant: EvidenceResponseVariant,
  userMessage: string
): string => {
  const objectPronoun = getObjectPronoun(evidenceLabel);
  const seed = `${variant}|retain|${userMessage}`;

  if (!consent.retain_evidence) {
    return pickFrom(
      [
        `Evidence retention is off, so SafeSpeak should not keep ${objectPronoun} beyond the consented flow.`,
        `Retention is off in your settings, so ${objectPronoun} should not be kept beyond the flow you consent to.`,
        `Your retention setting is off, so SafeSpeak should not keep ${objectPronoun} longer than the consented flow.`
      ],
      seed
    );
  }

  return pickFrom(
    [
      `Evidence retention is on, so SafeSpeak may keep ${objectPronoun} within the consented flow until you change that setting or remove ${objectPronoun}.`,
      `Retention is on in your settings, so ${objectPronoun} may be kept within that consented flow unless you change it later.`
    ],
    seed
  );
};

const getSafetySentence = (input: EvidenceComposerInput, evidenceLabel: string): string | null => {
  if (!hasHighRiskContext(input)) {
    return null;
  }

  const objectPronoun = getObjectPronoun(evidenceLabel);
  const platformMention = input.activeIncident?.platforms?.[0];

  if (platformMention) {
    return `Because threats were mentioned earlier, please put your immediate safety first before uploading ${objectPronoun}. If you feel in danger, call 000.`;
  }

  return `Please put your immediate safety first before uploading ${objectPronoun}. If you feel in danger, call 000.`;
};

const getQuestion = (
  evidenceLabel: string,
  consent: EvidenceConsentSnapshot,
  variant: EvidenceResponseVariant,
  userMessage: string
): string => {
  const objectPronoun = getObjectPronoun(evidenceLabel);
  const seed = `${variant}|question|${userMessage}`;

  if (asksAboutAiAnalysis(userMessage)) {
    return consent.process_with_ai
      ? pickFrom(
          [
            `Would you like to upload ${objectPronoun} without AI analysis for now?`,
            `Would you like to keep ${objectPronoun} as evidence first and decide about AI analysis later?`
          ],
          seed
        )
      : pickFrom(
          [
            `Would you like to keep ${objectPronoun} as evidence only for now?`,
            `Would you like to upload ${objectPronoun} without AI analysis and keep it as evidence only?`
          ],
          seed
        );
  }

  if (!consent.cloud_sync && consent.store_local) {
    return pickFrom(
      [
        `Would you like to keep ${objectPronoun} local only for now?`,
        `Would you like to add ${objectPronoun} to the local Evidence Vault?`,
        `Would you like to keep ${objectPronoun} in the local Evidence Vault for now?`
      ],
      seed
    );
  }

  if (consent.cloud_sync) {
    return pickFrom(
      [
        `Would you like to upload ${objectPronoun} with cloud sync on?`,
        `Would you like to upload ${objectPronoun} for review with your current sync settings?`,
        `Would you like to go ahead with upload under your current sync settings?`
      ],
      seed
    );
  }

  if (consent.share_with_agencies) {
    return pickFrom(
      [
        `Would you like to upload ${objectPronoun} for review first?`,
        `Would you like to add ${objectPronoun} first and decide about sharing later?`
      ],
      seed
    );
  }

  return pickFrom(
    [
      `Would you like to upload ${objectPronoun} now?`,
      `Would you like to add ${objectPronoun} for review first?`
    ],
    seed
  );
};

const validateEvidenceResponse = (assistantMessage: string, nextQuestion: string): void => {
  const combined = `${assistantMessage} ${nextQuestion}`.trim();

  if ((combined.match(/\?/g) ?? []).length > 1) {
    throw new Error('Evidence response must ask at most one question');
  }

  if (/\b(you should sue|this is illegal|you must|we uploaded|we shared|we sent)\b/i.test(combined)) {
    throw new Error('Evidence response violated SafeSpeak guardrails');
  }
};

export const composeEvidenceUploadResponse = (
  input: EvidenceComposerInput
): EvidenceComposerOutput => {
  const consentSnapshot = toConsentSnapshot(input.consent);
  const evidenceLabel = getEvidenceLabel(input.userMessage);
  const responseVariant = getResponseVariant(input, consentSnapshot);
  const aiAnalysisQuestion = asksAboutAiAnalysis(input.userMessage);
  const parts = [
    getDirectAnswer(input, evidenceLabel, responseVariant),
    getSharingSentence(evidenceLabel, consentSnapshot, responseVariant, input.userMessage),
    getStorageSentence(evidenceLabel, consentSnapshot, responseVariant, input.userMessage)
  ];

  if (!aiAnalysisQuestion || !consentSnapshot.process_with_ai) {
    parts.push(getRetentionSentence(evidenceLabel, consentSnapshot, responseVariant, input.userMessage));
  }

  if (aiAnalysisQuestion) {
    parts.push(
      consentSnapshot.process_with_ai
        ? 'AI processing is enabled in your settings, but SafeSpeak should still only analyse the file if you choose an AI step.'
        : 'Uploading the file should not automatically make SafeSpeak analyse it. AI processing is off in your settings, so SafeSpeak should not analyse the file unless you enable that later.'
    );
  }

  const safetySentence = getSafetySentence(input, evidenceLabel);
  if (safetySentence) {
    parts.push(safetySentence);
  }

  const assistantMessage = parts.map(collapseWhitespace).filter(Boolean).join('\n\n');
  const nextQuestion = getQuestion(
    evidenceLabel,
    consentSnapshot,
    responseVariant,
    input.userMessage
  );

  validateEvidenceResponse(assistantMessage, nextQuestion);

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
    reviewStatus: 'evidence_upload_intent',
    intent: 'evidence_upload_intent',
    responseMode: 'evidence_consent',
    subIntent: aiAnalysisQuestion ? 'ai_analysis_question' : undefined,
    intentConfidence: 'high',
    responseVariant,
    consentSnapshot
  };
};

export const composeSafeSpeakResponse = (input: {
  intent: 'evidence_upload_intent';
  evidenceUpload: EvidenceComposerInput;
}): EvidenceComposerOutput => composeEvidenceUploadResponse(input.evidenceUpload);
