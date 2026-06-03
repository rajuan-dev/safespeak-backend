import {
  getAssistantLanguagePromptLabel,
  type SupportedAssistantLanguageCode
} from './assistant-language';
import type { SafeSpeakResponsePlan } from './safespeak-response-planner';

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
  | 'over_answering'
  | 'too_many_pathways'
  | 'premature_documentation'
  | 'premature_reporting'
  | 'premature_legal_detail'
  | 'too_many_next_steps'
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
    'For emergencies in Australia, direct users to call 000.',
    'For family, domestic, or sexual violence support, mention 1800RESPECT where relevant.',
    'Never suggest 911, 999, or 112 for Australia.',
    'For legal or reporting questions, provide information only, not legal advice.',
    'Do not decide illegality, liability, guilt, outcomes, or whether the user can sue.',
    'Do not claim evidence was uploaded, saved, shared, synced, retained, or analysed unless backend-confirmed.',
    'Do not automatically report or share anything.',
    'Ask at most one user-facing question unless emergency safety requires otherwise.',
    'Use your reasoning to infer what the user is actually asking. Answer directly and helpfully. Be natural, context-aware, and specific. Do not sound generic or scripted.',
    'Choose the format that best helps: short paragraphs for conversation, bullets for options, steps, or red flags, and concise sections for explanations.',
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
    'Remove prohibited legal conclusions, wrong emergency numbers, false action claims, unsafe crisis guidance, and role violations.',
    'Keep the useful reasoning and specificity. Make it clear and concise, but do not make it vague.'
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
  'Revise the answer to better match SafeSpeak. Keep the useful reasoning and specificity. Remove only unsafe, legal-advice, or false-action content. Make it clear and concise, but do not make it vague. Use the best format for the user’s request.';

const countMatches = (text: string, patterns: RegExp[]): number =>
  patterns.reduce((total, pattern) => total + (text.match(pattern) ?? []).length, 0);

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
  responsePlan?: SafeSpeakResponsePlan;
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

  const plan = input.responsePlan;
  if (plan?.progressiveDisclosureStage === 'first_response') {
    const text = input.text;
    const latestUserMessageLower = latestUserMessage.toLowerCase();
    const userAskedForDocumentation =
      /\b(how can i|how do i|help me|can you help me|please help me)\b.*\b(document|documentation|evidence|photos?|screenshots?|timeline|organi[sz]e)\b/i.test(
        latestUserMessage
      ) || /\b(document it|organise it|organize it|help me document)\b/i.test(latestUserMessage);
    const userAskedForReporting = /\b(report|reporting|police|agency|where can i report|options)\b/i.test(
      latestUserMessage
    );
    const userAskedForLegal = /\b(legal|illegal|law|sue|rights|case)\b/i.test(latestUserMessage);
    const reportingMentions = countMatches(text, [
      /\bpolice\b/gi,
      /\breport(?:ing)?\b/gi,
      /\bagency\b/gi,
      /\b1800respect\b/gi,
      /\bfair work\b/gi,
      /\besafety\b/gi,
      /\boaic\b/gi
    ]);
    const documentationMentions = countMatches(text, [
      /\bevidence\b/gi,
      /\bphoto(?:s)?\b/gi,
      /\bscreenshot(?:s)?\b/gi,
      /\btimeline\b/gi,
      /\bdocument(?:ation)?\b/gi,
      /\brecord\b/gi
    ]);
    const legalMentions = countMatches(text, [
      /\billegal\b/gi,
      /\blegal\b/gi,
      /\bsue\b/gi,
      /\bcase\b/gi,
      /\brights\b/gi,
      /\bassault\b/gi,
      /\bharassment\b/gi
    ]);
    const bulletCount = (text.match(BULLET_LINE_PATTERN) ?? []).length;
    const pathSignals = [reportingMentions > 1, documentationMentions > 2, legalMentions > 1].filter(Boolean).length;

    if (!userAskedForDocumentation && documentationMentions >= 3) {
      violations.add('premature_documentation');
    }

    if (!userAskedForReporting && reportingMentions >= 2) {
      violations.add('premature_reporting');
    }

    if (!userAskedForLegal && legalMentions >= 2) {
      violations.add('premature_legal_detail');
    }

    if ((bulletCount >= 4 || countMatches(text, [/\bcan\b/gi, /\byou can\b/gi, /\byou could\b/gi]) >= 4) && latestUserMessageLower.length > 0) {
      violations.add('too_many_next_steps');
    }

    if (pathSignals >= 2) {
      violations.add('too_many_pathways');
    }

    if (
      (violations.has('premature_documentation') && violations.has('premature_reporting')) ||
      (violations.has('premature_reporting') && violations.has('premature_legal_detail')) ||
      (violations.has('too_many_pathways') && violations.has('too_many_next_steps'))
    ) {
      violations.add('over_answering');
    }
  }

  const wordCount = input.text.trim().split(/\s+/).filter(Boolean).length;
  const maxWordsByIntent: Partial<Record<string, number>> = {
    general_conversation: 90,
    meta_feedback: 90,
    format_preference_question: 70,
    format_preference_set: 55,
    physical_harm: 90,
    evidence_upload: 110,
    legal_boundary_specific_case: 95,
    legal_general_information: 170,
    scam_check: 130
  };
  const maxParagraphsByIntent: Partial<Record<string, number>> = {
    general_conversation: 4,
    meta_feedback: 4,
    format_preference_question: 4,
    format_preference_set: 2,
    physical_harm: 4,
    evidence_upload: 5,
    legal_boundary_specific_case: 4,
    legal_general_information: 5,
    scam_check: 5
  };
  const softWordGraceByIntent: Partial<Record<string, number>> = {
    general_conversation: 20,
    meta_feedback: 20,
    format_preference_question: 15,
    format_preference_set: 12,
    physical_harm: 20,
    evidence_upload: 25,
    legal_boundary_specific_case: 20,
    legal_general_information: 35,
    scam_check: 25
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
