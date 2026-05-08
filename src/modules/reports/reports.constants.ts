export const REPORT_STATUSES = [
  'draft',
  'local_only',
  'ready_for_review',
  'triaged',
  'info_only',
  'pending_submission',
  'submitted',
  'received',
  'withdrawn',
  'closed',
  'deleted'
] as const;

export const REPORT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const WITHDRAW_BLOCKED_STATUSES = ['submitted', 'received', 'closed', 'deleted'] as const;
