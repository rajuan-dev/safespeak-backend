import type { CONSENT_FLAGS } from './consent.constants';

export type ConsentFlag = (typeof CONSENT_FLAGS)[number];
export type ConsentFlags = Record<ConsentFlag, boolean>;

export interface ConsentOwner {
  userId?: string;
  sessionId?: string;
}
