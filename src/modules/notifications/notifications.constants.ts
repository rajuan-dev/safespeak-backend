export const USER_NOTIFICATION_ACTIONS = {
  list: 'notifications.list',
  read: 'notifications.read',
  readAll: 'notifications.read_all'
} as const;

export const USER_NOTIFICATION_TYPES = [
  'report_status',
  'report_delivery',
  'privacy_request',
  'support_request',
  'safety_plan',
  'system'
] as const;

export const USER_NOTIFICATION_SEVERITIES = [
  'info',
  'success',
  'warning',
  'critical'
] as const;

export const USER_NOTIFICATION_VIEWS = ['all', 'today', 'past'] as const;
