import type {
  USER_NOTIFICATION_SEVERITIES,
  USER_NOTIFICATION_TYPES
} from './notifications.constants';

export type UserNotificationType = (typeof USER_NOTIFICATION_TYPES)[number];
export type UserNotificationSeverity = (typeof USER_NOTIFICATION_SEVERITIES)[number];

export type UserNotificationSourceType =
  | 'report'
  | 'report_submission'
  | 'privacy_request'
  | 'warm_referral'
  | 'advocate_request'
  | 'help_support_request'
  | 'safety_plan';

export interface UserNotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  dateLabel: string;
  unread: boolean;
  readAt?: Date;
  type: UserNotificationType;
  severity: UserNotificationSeverity;
  createdAt: Date;
  sourceType: UserNotificationSourceType;
  sourceId?: string;
  actionLabel?: string;
  actionHref?: string;
  metadata?: Record<string, unknown>;
}

export type UserNotificationDraft = Omit<
  UserNotificationItem,
  'timestamp' | 'dateLabel' | 'unread' | 'readAt'
>;

export interface UserNotificationContext {
  userId: string;
  ip?: string;
  userAgent?: string;
}
