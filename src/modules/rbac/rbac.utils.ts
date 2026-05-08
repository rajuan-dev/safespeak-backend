import { ADMIN_ROLES, PUBLIC_ROLES } from './rbac.constants';
import type { UserRole } from './rbac.types';

export const isAdminRole = (role: UserRole): boolean => ADMIN_ROLES.includes(role as never);

export const isPublicRole = (role: UserRole): boolean => PUBLIC_ROLES.includes(role as never);

export const canAccessAdmin = (role: UserRole): boolean => isAdminRole(role);
