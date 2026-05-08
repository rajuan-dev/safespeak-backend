export const USER_ROLES = [
  'public_user',
  'advocate_user',
  'partner_user',
  'admin',
  'super_admin',
  'content_admin',
  'integration_admin',
  'analytics_viewer'
] as const;

export const PUBLIC_ROLES = ['public_user', 'advocate_user', 'partner_user'] as const;

export const ADMIN_ROLES = [
  'admin',
  'super_admin',
  'content_admin',
  'integration_admin',
  'analytics_viewer'
] as const;

export const USER_STATUSES = ['active', 'inactive', 'suspended', 'deleted'] as const;
