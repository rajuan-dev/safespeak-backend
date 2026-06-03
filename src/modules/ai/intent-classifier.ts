export type SafeSpeakIntent =
  | 'safety_crisis'
  | 'physical_harm'
  | 'incident_disclosure'
  | 'evidence_upload'
  | 'encoding_error'
  | 'ai_analysis_question'
  | 'legal_boundary'
  | 'rag_pathway_question'
  | 'scam_check'
  | 'language_or_translation'
  | 'meta_feedback'
  | 'general_conversation'
  | 'unknown';

export type IntentConfidence = 'high' | 'medium' | 'low';

export type SafeSpeakIntentClassification = {
  intent: SafeSpeakIntent;
  confidence: IntentConfidence;
  matchedSignals: string[];
  classifierSource: 'rule' | 'model' | 'hybrid';
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalize = (value: string): string =>
  collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const collectSignals = (normalized: string, rules: Array<{ signal: string; pattern: RegExp }>): string[] =>
  rules.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.signal);

export const detectMetaFeedbackOrCapabilityQuestion = (message: string): boolean => {
  const normalized = normalize(message);

  if (!normalized) {
    return false;
  }

  return (
    collectSignals(normalized, [
      { signal: 'scripted_feedback', pattern: /\b(you sound scripted|it sounds scripted|too scripted)\b/ },
      { signal: 'repetition_feedback', pattern: /\b(why are you replying the same thing|why are you repeating|too repetitive)\b/ },
      { signal: 'generic_feedback', pattern: /\b(why do you sound|why are you so generic|your answer is wrong)\b/ },
      { signal: 'chatgpt_feedback', pattern: /\b(be smart like chatgpt|respond like chatgpt|you should be smart)\b/ },
      { signal: 'naturalness_feedback', pattern: /\b(make it more natural|don t be static|don t give fixed template)\b/ }
    ]).length > 0
  );
};

const classifyByRule = (message: string): SafeSpeakIntentClassification => {
  const normalized = normalize(message);

  if (!normalized) {
    return {
      intent: 'unknown',
      confidence: 'low',
      matchedSignals: [],
      classifierSource: 'rule'
    };
  }

  const safetySignals = collectSignals(normalized, [
    { signal: 'immediate_danger_phrase', pattern: /\b(right now|outside my house|still here|still outside|coming back|following me)\b/ },
    { signal: 'weapon_or_kill_threat', pattern: /\b(weapon|knife|gun|kill me|kill us|threatening me right now)\b/ },
    { signal: 'unsafe_phrase', pattern: /\b(i am in danger|im in danger|unsafe right now|emergency)\b/ }
  ]);
  if (safetySignals.length > 0) {
    return {
      intent: 'safety_crisis',
      confidence: 'high',
      matchedSignals: safetySignals,
      classifierSource: 'rule'
    };
  }

  const physicalHarmSignals = collectSignals(normalized, [
    { signal: 'physical_harm_phrase', pattern: /\b(someone hit me|some one hit me|hit me|punched me|slapped me|kicked me|assaulted me|attacked me|hurt me)\b/ },
    { signal: 'incident_with_hit', pattern: /\b(i was|i am|someone|some one)\b.*\b(hit|punched|slapped|kicked|assaulted|attacked)\b/ }
  ]);
  if (physicalHarmSignals.length > 0) {
    return {
      intent: 'physical_harm',
      confidence: 'high',
      matchedSignals: physicalHarmSignals,
      classifierSource: 'rule'
    };
  }

  const aiAnalysisSignals = collectSignals(normalized, [
    { signal: 'ai_analysis_question', pattern: /\b(ai|artificial intelligence)\b.*\b(analy[sz]e|process|read|review|scan|check)\b/ },
    { signal: 'analysis_after_upload', pattern: /\b(will ai analy[sz]e|if i upload.*will ai|will safespeak analy[sz]e)\b/ }
  ]);
  if (aiAnalysisSignals.length > 0) {
    return {
      intent: 'ai_analysis_question',
      confidence: 'high',
      matchedSignals: aiAnalysisSignals,
      classifierSource: 'rule'
    };
  }

  const evidenceSignals = collectSignals(normalized, [
    { signal: 'evidence_upload_terms', pattern: /\b(upload|attach|share|add)\b.*\b(screenshot|screenshots|photo|photos|image|images|file|files|document|documents|evidence|proof)\b/ },
    { signal: 'evidence_question', pattern: /\b(can i upload|can i attach|i have screenshots|i have proof)\b/ }
  ]);
  if (evidenceSignals.length > 0) {
    return {
      intent: 'evidence_upload',
      confidence: 'high',
      matchedSignals: evidenceSignals,
      classifierSource: 'rule'
    };
  }

  const legalSignals = collectSignals(normalized, [
    { signal: 'legal_boundary_question', pattern: /\b(is this illegal|can i sue|what law applies|did they break the law|is that against the law)\b/ },
    { signal: 'rights_question', pattern: /\b(my rights|legal options|legal advice|legal issue)\b/ }
  ]);
  if (legalSignals.length > 0) {
    return {
      intent: 'legal_boundary',
      confidence: 'high',
      matchedSignals: legalSignals,
      classifierSource: 'rule'
    };
  }

  const ragPathwaySignals = collectSignals(normalized, [
    { signal: 'reporting_pathway_question', pattern: /\b(where can i report|reportcyber|scamwatch|esafety|fair work|anti discrimination|police report|what are my rights)\b/ },
    { signal: 'agency_question', pattern: /\b(which agency|what pathway|who do i report to)\b/ }
  ]);
  if (ragPathwaySignals.length > 0) {
    return {
      intent: 'rag_pathway_question',
      confidence: 'medium',
      matchedSignals: ragPathwaySignals,
      classifierSource: 'rule'
    };
  }

  const scamSignals = collectSignals(normalized, [
    { signal: 'scam_term', pattern: /\b(scam|fraud|phishing|fake link|otp|reportcyber|scamwatch)\b/ },
    { signal: 'identity_or_bank_risk', pattern: /\b(bank details|identity theft|passport|credit card|account hacked)\b/ }
  ]);
  if (scamSignals.length > 0) {
    return {
      intent: 'scam_check',
      confidence: scamSignals.length > 1 ? 'high' : 'medium',
      matchedSignals: scamSignals,
      classifierSource: 'rule'
    };
  }

  const incidentSignals = collectSignals(normalized, [
    { signal: 'incident_disclosure_term', pattern: /\b(happened|harassed|threatened|abused|followed me|touched me|they did this to me)\b/ },
    { signal: 'distress_context', pattern: /\b(scared|upset|someone followed me|someone touched me)\b/ }
  ]);
  if (incidentSignals.length > 0) {
    return {
      intent: 'incident_disclosure',
      confidence: 'medium',
      matchedSignals: incidentSignals,
      classifierSource: 'rule'
    };
  }

  const languageSignals = collectSignals(normalized, [
    { signal: 'language_request', pattern: /\b(can you speak|speak in|translate|bangla|bengali|arabic|hindi|spanish)\b/ }
  ]);
  if (languageSignals.length > 0) {
    return {
      intent: 'language_or_translation',
      confidence: 'high',
      matchedSignals: languageSignals,
      classifierSource: 'rule'
    };
  }

  if (detectMetaFeedbackOrCapabilityQuestion(message)) {
    return {
      intent: 'meta_feedback',
      confidence: 'high',
      matchedSignals: ['meta_feedback'],
      classifierSource: 'rule'
    };
  }

  const generalSignals = collectSignals(normalized, [
    { signal: 'greeting', pattern: /^(hi|hello|hey|good morning|good evening)\b/ },
    { signal: 'capability_question', pattern: /\b(what can you do)\b/ }
  ]);
  if (generalSignals.length > 0) {
    return {
      intent: 'general_conversation',
      confidence: 'high',
      matchedSignals: generalSignals,
      classifierSource: 'rule'
    };
  }

  if (normalized.split(' ').length <= 2) {
    return {
      intent: 'general_conversation',
      confidence: 'low',
      matchedSignals: ['short_general_turn'],
      classifierSource: 'rule'
    };
  }

  return {
    intent: 'unknown',
    confidence: 'low',
    matchedSignals: [],
    classifierSource: 'rule'
  };
};

export const classifySafeSpeakIntentDetails = (message: string): SafeSpeakIntentClassification =>
  classifyByRule(message);

export const classifySafeSpeakIntent = (message: string): SafeSpeakIntent =>
  classifySafeSpeakIntentDetails(message).intent;
