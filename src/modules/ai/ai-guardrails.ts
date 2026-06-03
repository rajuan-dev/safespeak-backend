import {
  getAssistantLanguagePromptLabel,
  type SupportedAssistantLanguageCode
} from './assistant-language';

const INFORMATION_ONLY_DISCLAIMER = 'This is information only, not legal advice.';

const LEGAL_ADVICE_RISK_PATTERNS = [
  /\bsuing is an option\b/i,
  /\byou can sue\b/i,
  /\byou should sue\b/i,
  /\byou must sue\b/i,
  /\byou have a case\b/i,
  /\bthis is definitely illegal\b/i,
  /\bthat is definitely illegal\b/i,
  /\bthey broke the law\b/i,
  /\byou will win\b/i,
  /\byou are entitled to compensation\b/i,
  /\bcriminal matter\b/i,
  /\bpolice handle this\b/i,
  /\byou must\b/i,
  /\byou need to\b/i
];

const CLINICAL_ADVICE_RISK_PATTERNS = [
  /\byou have (ptsd|depression|anxiety|trauma)\b/i,
  /\bi diagnose\b/i,
  /\bclinical advice\b/i,
  /\bmedical advice\b/i,
  /\btake (this )?medication\b/i,
  /\bstop taking (your )?medication\b/i,
  /\btherapy plan\b/i
];

const CRISIS_RISK_PATTERNS = [
  /\bi am in danger\b/i,
  /\bi'?m in danger\b/i,
  /\bimmediate danger\b/i,
  /\bi am unsafe\b/i,
  /\bi'?m unsafe\b/i,
  /\bunsafe right now\b/i,
  /\bi need help now\b/i,
  /\bpartner is threatening me\b/i,
  /\bmy partner is threatening me\b/i,
  /\bdomestic violence\b/i,
  /\bthreat to life\b/i,
  /\bviolence now\b/i
];

const POLICE_REPORTING_REQUEST_PATTERNS = [
  /\breport (this|it|me)? ?to police\b/i,
  /\bcontact police for me\b/i,
  /\bcall police for me\b/i,
  /\bcan you report\b.*\bpolice\b/i
];

const TRAINING_DATA_REQUEST_PATTERNS = [
  /\buse my report as training data\b/i,
  /\buse this as training data\b/i,
  /\btrain on my report\b/i,
  /\btrain on my chat\b/i,
  /\buse my (report|chat|evidence) for rag\b/i
];

const SAFESPEAK_PRODUCT_PATTERNS = [
  /\bwhat is safespeak\b/i,
  /\bhow does safespeak work\b/i,
  /\bwhat does safespeak do\b/i,
  /\bis safespeak\b/i
];

const AU_WRONG_EMERGENCY_PATTERNS = [/\b911\b/, /\b999\b/, /\b112\b/];
const FALSE_ACTION_CLAIM_PATTERNS = [
  /\bi uploaded\b/i,
  /\bwe uploaded\b/i,
  /\bsafespeak uploaded\b/i,
  /\bi shared this\b/i,
  /\bi sent it to an agency\b/i,
  /\bi sent this to police\b/i,
  /\bi contacted an agency\b/i,
  /\bi contacted police\b/i,
  /\bi analy[sz]ed the file\b/i,
  /\byour evidence has been saved\b/i,
  /\byour evidence has been synced\b/i,
  /\byour (?:photo|photos|file|files|evidence) (?:has|have) been (?:uploaded|saved|shared|sent|synced)\b/i,
  /\b(?:this|it|the file|the evidence) (?:has|have) been (?:uploaded|saved|shared|sent|synced)\b/i
];
const ROLE_VIOLATION_PATTERNS = [
  /\bi am your lawyer\b/i,
  /\bi am your counsellor\b/i,
  /\bi diagnosed\b/i,
  /\bi can represent you\b/i,
  /\bi will manage your case\b/i,
  /\bi contacted police\b/i
];
const SAFETY_PROMISE_PATTERNS = [/\byou are safe now\b/i, /\beverything will be okay\b/i];
const EVIDENCE_LEGAL_STRATEGY_PATTERNS = [
  /\bhard to dispute\b/i,
  /\bstrong evidence\b/i,
  /\bprove your case\b/i,
  /\bbuild your case\b/i,
  /\buse this against them\b/i,
  /\bthis proves\b/i
];
const BULLET_LINE_PATTERN = /^\s*(?:[-*•]|\d+\.)\s+/gm;

const STRUCTURED_BULLET_REQUEST_PATTERNS = [
  /\bbrief(?:ly)?\b/i,
  /\bexplain\b/i,
  /\btell me about\b/i,
  /\bsteps?\b/i,
  /\boptions?\b/i,
  /\bred flags?\b/i,
  /\bwarning signs?\b/i,
  /\bwhat should i look for\b/i,
  /\bhow can i document\b/i,
  /\bwhat can i do\b/i,
  /\borgani[sz]e(?:d)? answer\b/i,
  /\bbullet points?\b/i,
  /\bsummary\b/i
];

export type SafeSpeakGuardrailViolationCode =
  | 'wrong_au_emergency_number'
  | 'legal_conclusion'
  | 'missing_legal_boundary_disclaimer'
  | 'false_action_claim'
  | 'role_violation'
  | 'safety_promise'
  | 'evidence_legal_strategy'
  | 'bullet_heavy_non_actionable'
  | 'checklist_heavy_for_intent'
  | 'too_many_questions'
  | 'too_long_for_intent'
  | 'too_many_paragraphs_for_intent';

export type SafeSpeakGuardrailResult = {
  passed: boolean;
  violations: SafeSpeakGuardrailViolationCode[];
};

export type SafeSpeakGuardrailSeverity = 'hard' | 'soft';

const HARD_GUARDRAIL_VIOLATIONS = new Set<SafeSpeakGuardrailViolationCode>([
  'wrong_au_emergency_number',
  'legal_conclusion',
  'false_action_claim',
  'role_violation',
  'safety_promise'
]);

export const getSafeSpeakGuardrailSeverity = (
  violation: SafeSpeakGuardrailViolationCode
): SafeSpeakGuardrailSeverity => (HARD_GUARDRAIL_VIOLATIONS.has(violation) ? 'hard' : 'soft');

export const splitGuardrailViolations = (violations: SafeSpeakGuardrailViolationCode[]) => ({
  hard: violations.filter((violation) => getSafeSpeakGuardrailSeverity(violation) === 'hard'),
  soft: violations.filter((violation) => getSafeSpeakGuardrailSeverity(violation) === 'soft')
});

export const buildInformationOnlyDisclaimer = (): string => INFORMATION_ONLY_DISCLAIMER;

export const getSafeSpeakSystemPrompt = (language: string): string =>
  [
    'You are SafeSpeak Guide, a multilingual, trauma-informed community safety and support navigation guide for Australia.',
    'You are not a lawyer, police officer, therapist, counsellor, emergency service, or case manager.',
    'Your role is to guide safely, explain pathways, support documentation, reduce confusion, and help users feel informed and in control.',
    'Respond naturally and directly to the latest user message.',
    'Do not sound scripted. Do not reuse fixed templates. Do not repeat the same wording unless necessary for safety.',
    'Use calm, warm, neutral, professional, privacy-first language.',
    'Give options, not orders. Preserve user control.',
    'For emergencies in Australia, direct users to call 000.',
    'For family, domestic, or sexual violence support, mention 1800RESPECT where relevant.',
    'Never suggest 911, 999, or 112 for Australia.',
    'For legal or reporting questions, provide information only, not legal advice.',
    'Do not decide whether something is illegal. Do not say the user has a case. Do not tell the user to sue. Do not predict outcomes.',
    'Use words like may, possible, option, and pathway.',
    'For general conversation, reply briefly and naturally. Do not force triage or use trauma-informed language unless the user described harm.',
    'For meta-feedback, acknowledge the feedback naturally, answer briefly, and do not turn it into a triage or safety exchange.',
    'For format-preference questions, answer naturally and do not change preference unless the user explicitly requests a style.',
    'For physical harm, keep the response short. Mention 000 only when immediate danger, serious injury, or urgent risk is relevant. Ask only one safety question. Do not give a long checklist unless the user asks.',
    'For incident disclosure, acknowledge briefly, identify only a broad pathway when helpful, and ask one minimal clarifying question only if needed.',
    'For evidence upload questions, explain consent, storage, cloud sync, retention, and agency sharing only as relevant.',
    'Do not claim evidence has been uploaded, shared, synced, retained, or analysed unless a confirmed user action says that happened.',
    'Keep evidence guidance short, low-pressure, consent-aware, and documentation-focused.',
    'For evidence or photo messages, ask only one question and avoid legal-strategy framing.',
    'Avoid legal-strategy phrasing like hard to dispute, strong evidence, prove your case, build your case, or use this against them.',
    'For legal boundary questions about a specific situation, do not answer legality directly. Do not say you can sue, suing is an option, or that something is a criminal matter as a conclusion. State the information-only, not-legal-advice boundary and, if needed, ask one minimal jurisdiction or context question.',
    'For general legal education, brief plain-language overviews are allowed if you do not apply the law to the user’s facts.',
    'Use RAG when legal, source-grounded, or pathway-grounded information is available and needed. If RAG is unavailable, say the answer is general and not source-grounded when relevant.',
    'Never invent citations or sources.',
    'Do not push the user toward a complaint unless they asked about reporting or complaints.',
    'For AI-analysis questions, clearly separate upload from AI processing.',
    'Uploading a file does not automatically mean it is analysed unless the user chooses that AI step and consent allows it.',
    'For normal conversation or feedback about the assistant, answer directly and naturally.',
    'Triage early, not deeply. Collect only minimum safe understanding.',
    'Format intelligently. Do not default to bullets or paragraphs blindly.',
    'Prefer short paragraphs for normal conversation, meta-feedback, language requests, and simple answers.',
    'Use concise bullets when listing options, steps, red flags, evidence tips, warning signs, or pathways.',
    'Use numbered steps only when sequence matters.',
    'Respect explicit formatting preferences, but do not make answers unhelpfully vague.',
    'Do not force the user into incident triage.',
    'Ask at most one user-facing question unless emergency safety requires otherwise.',
    `Match the user language when clear and supported. Preferred language: ${getAssistantLanguagePromptLabel(
      language as SupportedAssistantLanguageCode
    )}.`
  ].join(' ');

export const buildRawDevSystemPrompt = (): string =>
  'You are a helpful assistant. Reply naturally and directly in plain text.';

export const buildGuardrailRevisionInstruction = (input?: {
  intent?: string;
  latestUserMessage?: string;
  violations?: SafeSpeakGuardrailViolationCode[];
}): string => {
  const instructions = [
    'Revise the answer to comply with SafeSpeak rules.',
    'Remove prohibited legal conclusions, wrong emergency numbers, false action claims, legal-strategy evidence language, commanding language like "you must" or "you need to", extra questions, and unnecessary length.',
    'Keep it brief, lower-pressure, information-only, and documentation-focused.'
  ];

  if (input?.intent === 'legal_boundary_specific_case') {
    instructions.push(
      'For this legal-boundary answer, clearly say this is information only, not legal advice.',
      'Do not decide legality or tell the user they can sue or have a case.',
      'Ask at most one minimal state or context question.'
    );
  }

  if (input?.intent === 'scam_check') {
    instructions.push(
      'For this scam answer, practical warning signs and concise bullets are allowed when helpful.',
      'Do not blame the user or claim certainty.'
    );
  }

  if (input?.intent === 'evidence_upload') {
    instructions.push(
      'For this evidence answer, keep it short and organized.',
      'Bullets or numbered steps are allowed when the user asks how to organize evidence.'
    );
  }

  if (input?.intent === 'physical_harm') {
    instructions.push(
      'For this physical-harm answer, avoid a long checklist.',
      'Keep it safety-aware, short, and ask only one question.'
    );
  }

  if (input?.intent === 'incident_disclosure') {
    instructions.push(
      'For this incident disclosure, acknowledge calmly, mention only a broad pathway if helpful, and ask one question max.'
    );
  }

  return instructions.join(' ');
};

export const buildCompactRetryInstruction = (): string =>
  'Rewrite more briefly in SafeSpeak persona. Keep the meaning. Use short paragraphs. Ask at most one question. Do not add new claims. Keep it information-only and low-pressure.';

const hasChecklistHeavyPattern = (input: {
  text: string;
  intent?: string;
}): boolean => {
  const bulletCount = (input.text.match(BULLET_LINE_PATTERN) ?? []).length;
  const checklistSignalCount = [
    /\b(screenshot|screenshots|photo|photos|evidence|timeline|document|report|police|doctor|hospital|insurance)\b/gi
  ]
    .flatMap((pattern) => input.text.match(pattern) ?? [])
    .length;

  if (input.intent === 'physical_harm') {
    return bulletCount > 1 || checklistSignalCount >= 4;
  }

  if (input.intent === 'evidence_upload') {
    return bulletCount > 5;
  }

  return false;
};

const allowsStructuredBullets = (input: {
  intent?: string;
  latestUserMessage?: string;
}): boolean => {
  const latestUserMessage = input.latestUserMessage ?? '';

  if (
    input.intent === 'scam_check' ||
    (input.intent === 'legal_general_information' &&
      /\bbrief(?:ly)?|explain|summary|summar(?:y|ise|ize)\b/i.test(latestUserMessage)) ||
    (input.intent === 'evidence_upload' &&
      /\borgani[sz]e|document|steps?|list|bullet points?\b/i.test(latestUserMessage))
  ) {
    return true;
  }

  return STRUCTURED_BULLET_REQUEST_PATTERNS.some((pattern) => pattern.test(latestUserMessage));
};

export const detectLegalAdviceRisk = (text: string): boolean =>
  LEGAL_ADVICE_RISK_PATTERNS.some((pattern) => pattern.test(text));

export const detectClinicalAdviceRisk = (text: string): boolean =>
  CLINICAL_ADVICE_RISK_PATTERNS.some((pattern) => pattern.test(text));

export const detectCrisisRisk = (text: string): boolean =>
  CRISIS_RISK_PATTERNS.some((pattern) => pattern.test(text));

export const detectPoliceReportingRequest = (text: string): boolean =>
  POLICE_REPORTING_REQUEST_PATTERNS.some((pattern) => pattern.test(text));

export const detectTrainingDataRequest = (text: string): boolean =>
  TRAINING_DATA_REQUEST_PATTERNS.some((pattern) => pattern.test(text));

export const detectSafeSpeakProductQuestion = (text: string): boolean =>
  SAFESPEAK_PRODUCT_PATTERNS.some((pattern) => pattern.test(text));

export const shouldRequireHumanReview = (flags: {
  legalAdviceRisk: boolean;
  clinicalAdviceRisk?: boolean;
  crisisRisk: boolean;
  insufficientSources: boolean;
  insufficientInput?: boolean;
}): boolean =>
  flags.legalAdviceRisk ||
  Boolean(flags.clinicalAdviceRisk) ||
  flags.crisisRisk ||
  flags.insufficientSources ||
  Boolean(flags.insufficientInput);

export const validateSafeSpeakResponse = (input: {
  text: string;
  intent?: string;
  jurisdiction?: string;
  allowMultipleQuestions?: boolean;
  latestUserMessage?: string;
  preferParagraphs?: boolean;
}): SafeSpeakGuardrailResult => {
  const violations = new Set<SafeSpeakGuardrailViolationCode>();
  const normalizedJurisdiction = (input.jurisdiction ?? 'AU').toUpperCase();
  const latestUserMessage = input.latestUserMessage ?? '';
  const paragraphCount = input.text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;

  if (
    normalizedJurisdiction === 'AU' &&
    AU_WRONG_EMERGENCY_PATTERNS.some((pattern) => pattern.test(input.text))
  ) {
    violations.add('wrong_au_emergency_number');
  }

  const hasAllowedLegalBoundaryLanguage =
    /\b(?:cannot|can’t|can't)\s+(?:decide|say|tell|determine)\b/i.test(input.text) ||
    /\binformation only\b/i.test(input.text) ||
    /\bnot legal advice\b/i.test(input.text);
  const hasProhibitedSuingConclusion =
    /\byou can sue\b/i.test(input.text) &&
    !/\bwhether you can sue\b/i.test(input.text) &&
    !/\b(?:cannot|can’t|can't)\s+(?:decide|say|tell|determine).{0,80}\byou can sue\b/i.test(input.text);
  const hasProhibitedCaseConclusion =
    /\byou have a case\b/i.test(input.text) &&
    !/\b(?:cannot|can’t|can't)\s+(?:decide|say|tell|determine).{0,80}\byou have a case\b/i.test(input.text);
  const hasProhibitedIllegalConclusion =
    (/\b(?:it|this|that) is illegal\b/i.test(input.text) ||
      /\bthis is definitely illegal\b/i.test(input.text) ||
      /\bthat is definitely illegal\b/i.test(input.text) ||
      /\bthey broke the law\b/i.test(input.text)) &&
    !hasAllowedLegalBoundaryLanguage;
  const hasDefinitiveIllegalConclusion =
    /\b(?:it|this|that) is illegal\b/i.test(input.text) &&
    !/\b(?:cannot|can’t|can't)\s+decide whether it is illegal\b/i.test(input.text) &&
    !/\bwhether it(?:'|’)s illegal depends\b/i.test(input.text);

  if (
    (LEGAL_ADVICE_RISK_PATTERNS.some((pattern) => pattern.test(input.text)) &&
      !hasAllowedLegalBoundaryLanguage) ||
    hasProhibitedSuingConclusion ||
    hasProhibitedCaseConclusion ||
    hasProhibitedIllegalConclusion ||
    hasDefinitiveIllegalConclusion
  ) {
    violations.add('legal_conclusion');
  }

  if (
    input.intent === 'legal_boundary_specific_case' &&
    !/\b(not legal advice|information only)\b/i.test(input.text)
  ) {
    violations.add('missing_legal_boundary_disclaimer');
  }

  if (
    /\bwhether it(?:'|’)s illegal depends\b/i.test(input.text) &&
    !/\b(i cannot|i can’t|safespeak cannot|safespeak can’t|not legal advice|information only)\b/i.test(
      input.text
    )
  ) {
    violations.add('legal_conclusion');
  }

  if (FALSE_ACTION_CLAIM_PATTERNS.some((pattern) => pattern.test(input.text))) {
    violations.add('false_action_claim');
  }

  if (ROLE_VIOLATION_PATTERNS.some((pattern) => pattern.test(input.text))) {
    violations.add('role_violation');
  }

  if (SAFETY_PROMISE_PATTERNS.some((pattern) => pattern.test(input.text))) {
    violations.add('safety_promise');
  }

  if (
    EVIDENCE_LEGAL_STRATEGY_PATTERNS.some((pattern) => pattern.test(input.text)) ||
    (/\bcomplaint\b/i.test(input.text) &&
      !/\b(complaint|complain|report|reporting|agency|police|oaic|esafety|fair work)\b/i.test(
        latestUserMessage
      ))
  ) {
    violations.add('evidence_legal_strategy');
  }

  if (!input.allowMultipleQuestions && (input.text.match(/\?/g) ?? []).length > 1) {
    violations.add('too_many_questions');
  }

  if (hasChecklistHeavyPattern({ text: input.text, intent: input.intent })) {
    violations.add('checklist_heavy_for_intent');
  }

  if (
    input.preferParagraphs &&
    !allowsStructuredBullets({
      intent: input.intent,
      latestUserMessage
    }) &&
    (input.text.match(BULLET_LINE_PATTERN) ?? []).length > 1
  ) {
    violations.add('bullet_heavy_non_actionable');
  }

  const wordCount = input.text.trim().split(/\s+/).filter(Boolean).length;
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
  const softWordGraceByIntent: Partial<Record<string, number>> = {
    general_conversation: 8,
    meta_feedback: 8,
    format_preference_question: 8,
    format_preference_set: 6,
    physical_harm: 10,
    evidence_upload: 10,
    legal_boundary_specific_case: 10,
    legal_general_information: 20,
    scam_check: 10
  };
  const maxWords = input.intent ? maxWordsByIntent[input.intent] : undefined;
  const maxParagraphs = input.intent ? maxParagraphsByIntent[input.intent] : undefined;
  const softWordGrace = input.intent ? softWordGraceByIntent[input.intent] : undefined;

  if (maxWords && wordCount > maxWords + (softWordGrace ?? 0)) {
    violations.add('too_long_for_intent');
  }

  if (maxParagraphs && paragraphCount > maxParagraphs) {
    violations.add('too_many_paragraphs_for_intent');
  }

  return {
    passed: violations.size === 0,
    violations: Array.from(violations)
  };
};

export const enforceAiOutputGuardrails = (text: string): string => text.trim();
