import type { SUPPORT_REQUEST_STATUSES, SUPPORT_SERVICE_TYPES } from './support.constants';

export type SupportServiceType = (typeof SUPPORT_SERVICE_TYPES)[number];
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

export interface SupportOwner {
  userId?: string;
  sessionId?: string;
}

export interface SupportServiceContext {
  owner: SupportOwner;
  ip?: string;
  userAgent?: string;
}
