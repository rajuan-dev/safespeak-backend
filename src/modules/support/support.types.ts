import type {
  SUPPORT_ISSUE_TYPES,
  SUPPORT_RESOURCE_RISK_LEVELS,
  SUPPORT_RESOURCE_TYPES,
  SUPPORT_REQUEST_STATUSES,
  SUPPORT_SERVICE_CARD_ICONS,
  SUPPORT_SERVICE_OVERLAY_TONES,
  SUPPORT_SERVICE_TYPES
} from './support.constants';

export type SupportServiceType = (typeof SUPPORT_SERVICE_TYPES)[number];
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];
export type SupportServiceCardIcon = (typeof SUPPORT_SERVICE_CARD_ICONS)[number];
export type SupportServiceOverlayTone = (typeof SUPPORT_SERVICE_OVERLAY_TONES)[number];
export type SupportResourceType = (typeof SUPPORT_RESOURCE_TYPES)[number];
export type SupportIssueType = (typeof SUPPORT_ISSUE_TYPES)[number];
export type SupportResourceRiskLevel = (typeof SUPPORT_RESOURCE_RISK_LEVELS)[number];

export interface SupportOwner {
  userId?: string;
  sessionId?: string;
}

export interface SupportServiceContext {
  owner: SupportOwner;
  ip?: string;
  userAgent?: string;
}

export interface AdminSupportServiceContext {
  adminUserId: string;
  ip?: string;
  userAgent?: string;
}
