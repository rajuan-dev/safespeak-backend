import {
  getAssistantLanguagePromptLabel,
  type SupportedAssistantLanguageCode
} from './assistant-language';

const INFORMATION_ONLY_DISCLAIMER =
  'This information is for general awareness only and does not constitute legal advice.';

const LEGAL_ADVICE_RISK_PATTERNS = [
  /\byou should sue\b/i,
  /\byou must report\b/i,
  /\bI advise you to\b/i,
  /\blegal advice\b/i,
  /\byou are entitled to compensation\b/i,
  /\byou have a case\b/i
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

export const buildInformationOnlyDisclaimer = (): string => INFORMATION_ONLY_DISCLAIMER;

export const getSafeSpeakSystemPrompt = (language: string): string =>
  [
    'You are SafeSpeak AI. Return only valid JSON.',
    'SafeSpeak is an information and triage tool only.',
    'SafeSpeak is not legal advice, counselling, crisis service, case-management, or automatic reporting.',
    'Never provide prescriptive legal advice like "you should sue" or "you must report".',
    'Use language like "options may include" and "you may consider".',
    'If immediate danger may be present, direct the person to call 000 immediately.',
    'If safe and relevant, mention 1800RESPECT as an official support option.',
    'Do not diagnose, provide therapy, or clinical advice.',
    'Cite authoritative sources where available. Do not treat internal product documents as legal authority.',
    'Do not add repetitive legal or policy disclaimers inside normal conversational replies.',
    'Keep the tone calm, human, supportive, and easy to talk to.',
    'Set reviewStatus to "pending_human_review".',
    `Respond in language: ${getAssistantLanguagePromptLabel(
      language as SupportedAssistantLanguageCode
    )}.`
  ].join(' ');

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

export const enforceAiOutputGuardrails = (text: string): string => {
  let safeText = text;

  safeText = safeText.replace(/\byou should sue\b/gi, 'options may include seeking legal information');
  safeText = safeText.replace(/\byou must report\b/gi, 'you may consider reporting if safe to do so');
  safeText = safeText.replace(/\byou are entitled to compensation\b/gi, 'compensation may be a legal topic to ask a qualified service about');
  safeText = safeText.replace(/\byou have a case\b/gi, 'an official legal or support service may help explain possible options');
  safeText = safeText.replace(/\byou have (ptsd|depression|anxiety|trauma)\b/gi, 'your wellbeing may have been affected');
  safeText = safeText.replace(/\btake (this )?medication\b/gi, 'speak with a qualified health professional about medication');
  safeText = safeText.replace(/\bstop taking (your )?medication\b/gi, 'speak with a qualified health professional before changing medication');

  return safeText;
};
