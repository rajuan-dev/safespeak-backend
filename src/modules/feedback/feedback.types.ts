import type { FEEDBACK_SOURCES, FEEDBACK_STATUSES } from './feedback.constants';

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export interface FeedbackOwner {
  userId?: string;
  sessionId?: string;
}

export interface FeedbackServiceContext {
  owner: FeedbackOwner;
  ip?: string;
  userAgent?: string;
}

export interface AdminFeedbackServiceContext {
  adminUserId: string;
  ip?: string;
  userAgent?: string;
}
