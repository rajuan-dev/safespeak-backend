import type { Types } from 'mongoose';

import type { UserRole, UserStatus } from '@modules/rbac/rbac.types';

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthenticatedUserPayload {
  userId: string;
  role: UserRole;
}

export interface UserIdentity {
  _id: Types.ObjectId;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
}
