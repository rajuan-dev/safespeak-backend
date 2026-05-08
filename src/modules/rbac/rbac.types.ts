import type { ADMIN_ROLES, PUBLIC_ROLES, USER_ROLES, USER_STATUSES } from './rbac.constants';

export type UserRole = (typeof USER_ROLES)[number];
export type PublicRole = (typeof PUBLIC_ROLES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
