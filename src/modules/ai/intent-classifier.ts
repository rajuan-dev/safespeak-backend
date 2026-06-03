export type SafeSpeakIntent =
  | 'safety_crisis'
  | 'evidence_upload_intent'
  | 'ai_analysis_question'
  | 'legal_boundary_intent'
  | 'rag_pathway_question'
  | 'physical_harm'
  | 'safety_physical_harm'
  | 'incident_disclosure'
  | 'scam_check'
  | 'language_or_translation'
  | 'meta_feedback_or_capability_question'
  | 'general_conversation'
  | 'unknown';

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalize = (value: string): string =>
  collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const detectMetaFeedbackOrCapabilityQuestion = (message: string): boolean => {
  const normalized = normalize(message);

  if (!normalized) {
    return false;
  }

  const patterns = [
    /\bwill you always respond the same\b/,
    /\bwhy are you replying like this\b/,
    /\byou should be smart\b/,
    /\brespond like chatgpt\b/,
    /\bthis sounds scripted\b/,
    /\bit sounds scripted\b/,
    /\bdon t give fixed template\b/,
    /\bwhy are you repeating the same thing\b/,
    /\bare you ai\b/,
    /\bwhat can you do\b/,
    /\bhow will you respond\b/,
    /\byour answer is wrong\b/,
    /\bmake it more natural\b/,
    /\bdon t be static\b/,
    /\btoo scripted\b/,
    /\btoo repetitive\b/,
    /\bwhy are you repeating\b/,
    /\bwill you response like same thing\b/,
    /\bwill you respond like same thing\b/,
    /\bif ask you anything\b/,
    /\byou should be smarter\b/,
    /\bwhat will you response\b/,
    /\bwhat will you respond\b/,
    /\bwhy do you sound\b/,
    /\bwhy are you so generic\b/
  ];

  return patterns.some((pattern) => pattern.test(normalized));
};

export const classifySafeSpeakIntent = (message: string): SafeSpeakIntent => {
  const normalized = normalize(message);

  if (!normalized) {
    return 'unknown';
  }

  if (
    /\b(i am in danger|im in danger|unsafe right now|call 000|emergency|weapon|knife|gun|kill me|hurting me right now)\b/.test(
      normalized
    )
  ) {
    return 'safety_crisis';
  }

  if (
    /\b(hit me|someone hit me|some one hit me|punched me|slapped me|kicked me|assaulted me|hurt me)\b/.test(
      normalized
    )
  ) {
    return /\b(now|right now|tonight|still here|following me|in danger|unsafe)\b/.test(normalized)
      ? 'safety_physical_harm'
      : 'physical_harm';
  }

  if (
    /\b(happened|harassed|threatened|abused|scared|someone followed me|someone touched me|they did this to me)\b/.test(
      normalized
    )
  ) {
    return 'incident_disclosure';
  }

  if (detectMetaFeedbackOrCapabilityQuestion(message)) {
    return 'meta_feedback_or_capability_question';
  }

  return 'unknown';
};
