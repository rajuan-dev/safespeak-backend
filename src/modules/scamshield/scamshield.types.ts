import type {
  SCAMSHIELD_ANALYSIS_TYPES,
  SCAMSHIELD_RISK_LEVELS,
  SCAMSHIELD_STATUSES
} from './scamshield.constants';

export type ScamShieldAnalysisType = (typeof SCAMSHIELD_ANALYSIS_TYPES)[number];
export type ScamShieldRiskLevel = (typeof SCAMSHIELD_RISK_LEVELS)[number];
export type ScamShieldStatus = (typeof SCAMSHIELD_STATUSES)[number];

export interface ScamShieldOwner {
  userId?: string;
  sessionId?: string;
}

export interface ScamShieldServiceContext {
  owner: ScamShieldOwner;
  ip?: string;
  userAgent?: string;
}
