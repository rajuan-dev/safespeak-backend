import type { SafeSpeakIntent } from './intent-classifier';

export type SafeSpeakIntentPolicy = {
  intent: SafeSpeakIntent;
  useRagByDefault: boolean;
  mutateTriage: boolean;
  guidance: string[];
};

const POLICY_MAP: Record<SafeSpeakIntent, SafeSpeakIntentPolicy> = {
  safety_crisis: {
    intent: 'safety_crisis',
    useRagByDefault: false,
    mutateTriage: true,
    guidance: [
      'Keep the reply short, direct, calm, and safety-first.',
      'Use 000 for immediate danger in Australia.',
      'Mention 1800RESPECT when family, domestic, or sexual violence support may be relevant.',
      'Do not ask many questions or provide a long checklist.'
    ]
  },
  physical_harm: {
    intent: 'physical_harm',
    useRagByDefault: false,
    mutateTriage: true,
    guidance: [
      'Be safety-aware, calm, and brief.',
      'Mention 000 only when immediate danger, serious injury, or urgent risk may be present.',
      'Ask one question only.'
    ]
  },
  incident_disclosure: {
    intent: 'incident_disclosure',
    useRagByDefault: false,
    mutateTriage: true,
    guidance: [
      'Acknowledge briefly and keep the user in control.',
      'Identify only a broad possible pathway if helpful.',
      'Ask one minimal clarifying question only when needed.',
      'Do not interrogate or force report-building.'
    ]
  },
  evidence_upload: {
    intent: 'evidence_upload',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Keep the reply low-pressure, consent-aware, and documentation-focused.',
      'Do not claim anything was uploaded, saved, shared, synced, retained, or analysed unless confirmed.',
      'Do not use legal-strategy wording.',
      'Ask one relevant question only.'
    ]
  },
  encoding_error: {
    intent: 'encoding_error',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Do not call the model for this path.',
      'Ask the user to resend because text encoding appears broken.'
    ]
  },
  ai_analysis_question: {
    intent: 'ai_analysis_question',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Clearly separate upload from AI processing.',
      'Explain that AI processing depends on consent and user action.',
      'Do not claim analysis happened unless the backend confirms it.'
    ]
  },
  legal_boundary_specific_case: {
    intent: 'legal_boundary_specific_case',
    useRagByDefault: true,
    mutateTriage: true,
    guidance: [
      'Use a strict legal boundary.',
      'State that this is information only, not legal advice.',
      'Do not decide legality, criminality, liability, or outcome.',
      'Do not say the user can sue or has a case.',
      'Use RAG when legal sources are available.',
      'If legal RAG is missing, say no matched legal source is loaded and keep the answer general.',
      'Ask one minimal jurisdiction or context question if needed.'
    ]
  },
  legal_general_information: {
    intent: 'legal_general_information',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'General legal education is allowed.',
      'Give a brief plain-language explanation in 2 to 4 short paragraphs when appropriate.',
      'State that this is information only, not legal advice.',
      'Do not apply the law to the user’s facts.',
      'Do not invent citations.',
      'If RAG is unavailable, make clear the answer is a general overview and not source-grounded.'
    ]
  },
  rag_pathway_question: {
    intent: 'rag_pathway_question',
    useRagByDefault: true,
    mutateTriage: true,
    guidance: [
      'Use RAG when available.',
      'Explain possible pathways, not decisions.',
      'Include source metadata only when sources were actually retrieved.',
      'Do not invent citations.'
    ]
  },
  scam_check: {
    intent: 'scam_check',
    useRagByDefault: false,
    mutateTriage: true,
    guidance: [
      'Stay calm, practical, and non-judgmental.',
      'Identify warning signs without claiming certainty.',
      'Do not say the user definitely got scammed.',
      'Suggest safe verification or reporting options.'
    ]
  },
  language_or_translation: {
    intent: 'language_or_translation',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Respond in the requested language when supported.',
      'Avoid mojibake.',
      'Do not update triage unless the user also discloses harm.'
    ]
  },
  meta_feedback: {
    intent: 'meta_feedback',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Acknowledge the feedback naturally and briefly.',
      'Explain behavior briefly if useful.',
      'Do not trigger triage.',
      'Do not sound technical or scripted.'
    ]
  },
  general_conversation: {
    intent: 'general_conversation',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Answer naturally and briefly.',
      'Do not use trauma language unless harm is disclosed.',
      'Do not force triage.',
      'Do not use RAG unless the user asks a factual, source, or pathway question.'
    ]
  },
  format_preference_question: {
    intent: 'format_preference_question',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Answer naturally.',
      'Do not change the format preference unless the user explicitly requests a style.',
      'Do not trigger triage.'
    ]
  },
  format_preference_set: {
    intent: 'format_preference_set',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: [
      'Acknowledge the format preference naturally.',
      'Do not trigger triage.'
    ]
  },
  unknown: {
    intent: 'unknown',
    useRagByDefault: false,
    mutateTriage: false,
    guidance: ['Reply naturally and ask at most one clarifying question if needed.']
  }
};

export const getSafeSpeakIntentPolicy = (intent: SafeSpeakIntent): SafeSpeakIntentPolicy =>
  POLICY_MAP[intent];
