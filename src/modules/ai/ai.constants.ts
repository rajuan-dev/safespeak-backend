export const AI_ACTIONS = {
  extractIncidentFields: 'ai.extract_incident_fields',
  triageReport: 'ai.triage_report',
  clarifyingQuestions: 'ai.clarifying_questions',
  generateSummary: 'ai.generate_summary',
  translate: 'ai.translate',
  redactPii: 'ai.redact_pii',
  ragAnswer: 'ai.rag_answer'
} as const;

export const AI_REVIEW_STATUSES = ['pending_human_review', 'approved', 'rejected'] as const;

export const AI_GUARDRAILS = [
  'information_only',
  'cite_sources_when_available',
  'human_in_loop_review_required',
  'multilingual_supported',
  'no_prescriptive_legal_advice'
] as const;

export const DEFAULT_AI_LANGUAGE = 'en';
