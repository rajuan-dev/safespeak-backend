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

export const REPORT_SUBMISSION_STATUSES = [
  'draft_preview',
  'queued',
  'submitted',
  'acknowledged',
  'requires_manual_action',
  'config_missing',
  'withdrawn',
  'failed'
] as const;

export const REPORT_SUBMISSION_ANONYMITY_MODES = [
  'identified',
  'anonymous',
  'pseudonymous'
] as const;
