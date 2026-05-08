import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { isAdminRole, isPublicRole } from '@modules/rbac/rbac.utils';

import { UserModel } from './auth.model';
import type { UserDocument } from './auth.model';
import type { LoginInput, RegisterInput } from './auth.schema';
import type { AuthTokens, SafeUser } from './auth.types';
import {
  buildAuthTokens,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
  verifyRefreshToken,
  verifyRefreshTokenHash
} from './auth.utils';

const toSafeUser = (user: HydratedDocument<UserDocument> | null): SafeUser => {
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  return {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
};

const issueTokens = async (userId: string, role: SafeUser['role']): Promise<AuthTokens> => {
  const tokens = buildAuthTokens({ userId, role });
  const refreshTokenHash = await hashRefreshToken(tokens.refreshToken);

  await UserModel.findByIdAndUpdate(userId, {
    refreshTokenHash,
    lastLoginAt: new Date()
  });

  return tokens;
};

export const registerUser = async (
  input: RegisterInput,
  ip?: string,
  userAgent?: string
): Promise<{ user: SafeUser; tokens: AuthTokens }> => {
  const existingUser = await UserModel.findOne({ email: input.email.toLowerCase() });

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email is already registered');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    email: input.email,
    fullName: input.fullName,
    passwordHash,
    role: 'public_user',
    status: 'active'
  });
  const safeUser = toSafeUser(user);
  const tokens = await issueTokens(safeUser.id, safeUser.role);

  await createAuditLog({
    actorType: 'user',
    actorId: safeUser.id,
    action: 'auth.register',
    resourceType: 'auth',
    resourceId: safeUser.id,
    ip,
    userAgent
  });

  return { user: safeUser, tokens };
};

export const loginUser = async (
  input: LoginInput,
  adminOnly: boolean,
  ip?: string,
  userAgent?: string
): Promise<{ user: SafeUser; tokens: AuthTokens }> => {
  const user = await UserModel.findOne({ email: input.email.toLowerCase() }).select(
    '+passwordHash +refreshTokenHash'
  );

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new ApiError(StatusCodes.FORBIDDEN, 'User account is not active');
  }

  if (adminOnly && !isAdminRole(user.role)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin access is required');
  }

  if (!adminOnly && !isPublicRole(user.role)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Use the admin login endpoint for this account');
  }

  const safeUser = toSafeUser(user);
  const tokens = await issueTokens(safeUser.id, safeUser.role);

  await createAuditLog({
    actorType: adminOnly ? 'admin' : 'user',
    actorId: safeUser.id,
    action: adminOnly ? 'auth.admin_login' : 'auth.login',
    resourceType: 'auth',
    resourceId: safeUser.id,
    ip,
    userAgent
  });

  return { user: safeUser, tokens };
};

export const refreshUserToken = async (
  refreshToken: string
): Promise<{ user: SafeUser; tokens: AuthTokens }> => {
  const payload = verifyRefreshToken(refreshToken);
  const user = await UserModel.findById(payload.userId).select('+refreshTokenHash');

  if (!user || !user.refreshTokenHash) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid refresh token');
  }

  const isValid = await verifyRefreshTokenHash(refreshToken, user.refreshTokenHash);

  if (!isValid || user.status !== 'active') {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid refresh token');
  }

  const safeUser = toSafeUser(user);
  const tokens = await issueTokens(safeUser.id, safeUser.role);

  return { user: safeUser, tokens };
};

export const logoutUser = async (userId?: string): Promise<void> => {
  if (!userId) {
    return;
  }

  await UserModel.findByIdAndUpdate(userId, {
    $unset: {
      refreshTokenHash: ''
    }
  });
};

export const getSafeUserById = async (userId: string): Promise<SafeUser> => {
  const user = await UserModel.findById(userId);

  return toSafeUser(user);
};
