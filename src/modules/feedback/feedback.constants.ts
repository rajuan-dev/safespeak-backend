export const FEEDBACK_STATUSES = ['new', 'in_review', 'resolved', 'dismissed'] as const;

export const FEEDBACK_SOURCES = [
  'user_feedback',
  'support_follow_up',
  'impact_survey',
  'admin_created'
] as const;

export const FEEDBACK_ACTIONS = {
  create: 'feedback.create',
  adminList: 'admin.feedback.list',
  adminUpdate: 'admin.feedback.update'
} as const;
