import {
  getAssistantLanguagePromptLabel,
  type SupportedAssistantLanguageCode
} from './assistant-language';

const INFORMATION_ONLY_DISCLAIMER = 'This is information only, not legal advice.';

const LEGAL_ADVICE_RISK_PATTERNS = [
  /\byou should sue\b/i,
  /\byou must sue\b/i,
  /\byou have a case\b/i,
  /\bthis is illegal\b/i,
  /\bthat is illegal\b/i,
  /\bthey broke the law\b/i,
  /\byou will win\b/i,
  /\byou are entitled to compensation\b/i
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
  /\bi shared this\b/i,
  /\bi sent this to police\b/i,
  /\bi contacted an agency\b/i,
  /\byour evidence has been saved\b/i,
  /\byour evidence has been synced\b/i
];
const ROLE_VIOLATION_PATTERNS = [
  /\bi am your lawyer\b/i,
  /\bi am your counsellor\b/i,
  /\bi diagnosed\b/i,
  /\bi can represent you\b/i,
  /\bi will manage your case\b/i
];
const SAFETY_PROMISE_PATTERNS = [/\byou are safe now\b/i, /\beverything will be okay\b/i];
const EVIDENCE_LEGAL_STRATEGY_PATTERNS = [
  /\bhard to dispute\b/i,
  /\bstrong evidence\b/i,
  /\bprove your case\b/i,
  /\bbuild your case\b/i,
  /\buse this against them\b/i
];

export type SafeSpeakGuardrailViolationCode =
  | 'wrong_au_emergency_number'
  | 'legal_conclusion'
  | 'false_action_claim'
  | 'role_violation'
  | 'safety_promise'
  | 'evidence_legal_strategy'
  | 'too_many_questions';

export type SafeSpeakGuardrailResult = {
  passed: boolean;
  violations: SafeSpeakGuardrailViolationCode[];
};

export const buildInformationOnlyDisclaimer = (): string => INFORMATION_ONLY_DISCLAIMER;

export const getSafeSpeakSystemPrompt = (language: string): string =>
  [
    'You are SafeSpeak Guide, a multilingual, trauma-informed community safety navigation assistant for Australia.',
    'You are not a lawyer, police officer, therapist, counsellor, emergency service, or case manager.',
    'Your role is to guide safely, explain possible pathways, support documentation, reduce confusion, and preserve user control.',
    'Respond naturally and directly to the latest user message.',
    'Do not sound scripted. Do not reuse fixed templates. Do not repeat the same wording unless necessary for safety.',
    'Use calm, plain language.',
    'For emergencies in Australia, direct users to call 000.',
    'For family, domestic, or sexual violence support, mention 1800RESPECT where relevant.',
    'Never suggest 911, 999, or 112 for Australia.',
    'For legal or reporting questions, provide information only, not legal advice.',
    'Do not decide whether something is illegal. Do not say the user has a case. Do not tell the user to sue.',
    'Use words like may, possible, option, and pathway.',
    'For evidence upload questions, explain consent, storage, cloud sync, retention, and agency sharing only as relevant.',
    'Do not claim evidence has been uploaded, shared, synced, retained, or analysed unless a confirmed user action says that happened.',
    'Keep evidence guidance short, low-pressure, consent-aware, and documentation-focused.',
    'Avoid legal-strategy phrasing like hard to dispute, strong evidence, prove your case, build your case, or use this against them.',
    'Do not push the user toward a complaint unless they asked about reporting or complaints.',
    'For AI-analysis questions, clearly separate upload from AI processing.',
    'Uploading a file does not automatically mean it is analysed unless the user chooses that AI step and consent allows it.',
    'For normal conversation or feedback about the assistant, answer directly and naturally.',
    'Do not force the user into incident triage.',
    'Ask at most one user-facing question unless emergency safety requires otherwise.',
    `Match the user language when clear and supported. Preferred language: ${getAssistantLanguagePromptLabel(
      language as SupportedAssistantLanguageCode
    )}.`
  ].join(' ');

export const buildRawDevSystemPrompt = (): string =>
  'You are a helpful assistant. Reply naturally and directly in plain text.';

export const buildGuardrailRevisionInstruction = (): string =>
  'Revise the answer to comply with SafeSpeak rules. Remove prohibited legal conclusions, wrong emergency numbers, false action claims, legal-strategy evidence language, and extra questions. Make this lower-pressure, information-only, and documentation-focused.';

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
  jurisdiction?: string;
  allowMultipleQuestions?: boolean;
  latestUserMessage?: string;
}): SafeSpeakGuardrailResult => {
  const violations = new Set<SafeSpeakGuardrailViolationCode>();
  const normalizedJurisdiction = (input.jurisdiction ?? 'AU').toUpperCase();
  const latestUserMessage = input.latestUserMessage ?? '';

  if (
    normalizedJurisdiction === 'AU' &&
    AU_WRONG_EMERGENCY_PATTERNS.some((pattern) => pattern.test(input.text))
  ) {
    violations.add('wrong_au_emergency_number');
  }

  if (LEGAL_ADVICE_RISK_PATTERNS.some((pattern) => pattern.test(input.text))) {
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

  return {
    passed: violations.size === 0,
    violations: Array.from(violations)
  };
};

export const enforceAiOutputGuardrails = (text: string): string => text.trim();
