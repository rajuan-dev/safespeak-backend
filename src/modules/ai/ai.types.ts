import type { AI_ACTIONS, AI_REVIEW_STATUSES } from './ai.constants';

export type AiAction = (typeof AI_ACTIONS)[keyof typeof AI_ACTIONS];
export type AiReviewStatus = (typeof AI_REVIEW_STATUSES)[number];

export interface AiOwner {
  userId?: string;
  sessionId?: string;
}

export interface AiCitation {
  sourceType: 'report' | 'evidence' | 'knowledge_source' | 'user_input';
  sourceId?: string;
  title?: string;
  excerpt?: string;
}

export interface AiGuardrailResult {
  informationOnly: true;
  requiresHumanReview: true;
  legalAdviceDisclaimer: string;
  language: string;
}

export interface AiServiceContext {
  owner: AiOwner;
  ip?: string;
  userAgent?: string;
}

export interface AudioTranscriptionOutput {
  transcript: string;
  language?: string;
  model: string;
  reportId?: string;
  evidenceId?: string;
  saved: boolean;
}
