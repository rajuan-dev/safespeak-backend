const INFORMATION_ONLY_DISCLAIMER =
  'This information is for general awareness only and does not constitute legal advice.';

const LEGAL_ADVICE_RISK_PATTERNS = [
  /\byou should sue\b/i,
  /\byou must report\b/i,
  /\bI advise you to\b/i,
  /\blegal advice\b/i
];

const CRISIS_RISK_PATTERNS = [
  /\bimmediate danger\b/i,
  /\bunsafe right now\b/i,
  /\bthreat to life\b/i,
  /\bviolence now\b/i
];

export const buildInformationOnlyDisclaimer = (): string => INFORMATION_ONLY_DISCLAIMER;

export const getSafeSpeakSystemPrompt = (language: string): string =>
  [
    'You are SafeSpeak AI. Return only valid JSON.',
    'SafeSpeak is an information and triage tool only.',
    'SafeSpeak is not legal advice, counselling, crisis service, case-management, or automatic reporting.',
    'Never provide prescriptive legal advice like "you should sue" or "you must report".',
    'Use language like "options may include", "you may consider", and "this is general information only".',
    'If immediate danger may be present, direct the person to call 000 immediately.',
    'If safe and relevant, mention 1800RESPECT as an official support option.',
    'Do not diagnose, provide therapy, or clinical advice.',
    'Cite authoritative sources where available. Do not treat internal product documents as legal authority.',
    `Include disclaimer: "${INFORMATION_ONLY_DISCLAIMER}" and reviewStatus: "pending_human_review".`,
    `Respond in language: ${language}.`
  ].join(' ');

export const detectLegalAdviceRisk = (text: string): boolean =>
  LEGAL_ADVICE_RISK_PATTERNS.some((pattern) => pattern.test(text));

export const detectCrisisRisk = (text: string): boolean =>
  CRISIS_RISK_PATTERNS.some((pattern) => pattern.test(text));

export const shouldRequireHumanReview = (flags: {
  legalAdviceRisk: boolean;
  crisisRisk: boolean;
  insufficientSources: boolean;
}): boolean => flags.legalAdviceRisk || flags.crisisRisk || flags.insufficientSources;

export const enforceAiOutputGuardrails = (text: string): string => {
  let safeText = text;

  safeText = safeText.replace(/\byou should sue\b/gi, 'options may include seeking legal information');
  safeText = safeText.replace(/\byou must report\b/gi, 'you may consider reporting if safe to do so');

  if (!safeText.toLowerCase().includes(INFORMATION_ONLY_DISCLAIMER.toLowerCase())) {
    safeText = `${safeText}\n\n${INFORMATION_ONLY_DISCLAIMER}`;
  }

  return safeText;
};
