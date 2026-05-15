import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';
import { randomBytes } from 'node:crypto';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { isAdminRole, isPublicRole } from '@modules/rbac/rbac.utils';

import { UserModel } from './auth.model';
import type { UserDocument } from './auth.model';
import type { LoginInput, RegisterInput } from './auth.schema';
import type { AuthData, AuthTokens, SafeUser } from './auth.types';
import {
  buildAuthTokens,
  deriveFullNameFromEmail,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
  verifyRefreshToken,
  verifyRefreshTokenHash
} from './auth.utils';

export interface GoogleProfileInput {
  googleId: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
}

const toSafeUser = (user: HydratedDocument<UserDocument> | null): SafeUser => {
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  return {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
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
): Promise<AuthData> => {
  const email = input.email.toLowerCase();
  const existingUser = await UserModel.findOne({ email });

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email is already registered');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    email,
    fullName: input.fullName ?? deriveFullNameFromEmail(email),
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
): Promise<AuthData> => {
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

export const loginWithGoogleProfile = async (
  input: GoogleProfileInput,
  ip?: string,
  userAgent?: string
): Promise<AuthData> => {
  const email = input.email.toLowerCase();
  let user = await UserModel.findOne({
    $or: [{ googleId: input.googleId }, { email }]
  }).select('+refreshTokenHash');
  let action = 'auth.google_login';

  if (user) {
    if (user.status !== 'active') {
      throw new ApiError(StatusCodes.FORBIDDEN, 'User account is not active');
    }

    if (!isPublicRole(user.role)) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Use the admin login endpoint for this account');
    }

    user.googleId = user.googleId ?? input.googleId;
    user.authProvider = user.authProvider === 'local' ? 'local' : 'google';
    user.isEmailVerified = true;
    user.fullName = user.fullName || input.fullName;
    user.avatarUrl = input.avatarUrl ?? user.avatarUrl;
    await user.save();
  } else {
    action = 'auth.google_register';
    user = await UserModel.create({
      email,
      fullName: input.fullName,
      googleId: input.googleId,
      authProvider: 'google',
      avatarUrl: input.avatarUrl,
      passwordHash: await hashPassword(randomBytes(32).toString('hex')),
      role: 'public_user',
      status: 'active',
      isEmailVerified: true
    });
  }

  const safeUser = toSafeUser(user);
  const tokens = await issueTokens(safeUser.id, safeUser.role);

  await createAuditLog({
    actorType: 'user',
    actorId: safeUser.id,
    action,
    resourceType: 'auth',
    resourceId: safeUser.id,
    ip,
    userAgent
  });

  return { user: safeUser, tokens };
};

export const refreshUserToken = async (
  refreshToken: string
): Promise<AuthData> => {
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
