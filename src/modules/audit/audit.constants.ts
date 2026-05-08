export const AUDIT_ACTOR_TYPES = ['user', 'admin', 'anonymous_session', 'system'] as const;

export const AUDIT_RESOURCE_TYPES = [
  'auth',
  'session',
  'consent',
  'evidence',
  'profile',
  'report',
  'user',
  'system'
] as const;
