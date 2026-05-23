import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';
import { isAdminRole, isPublicRole } from '@modules/rbac/rbac.utils';

import { PasswordResetRequestModel } from './auth-password-reset.model';
import { UserModel } from './auth.model';
import type { UserDocument } from './auth.model';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  PasswordResetAudience,
  RegisterInput,
  ResetPasswordInput,
  UpdateCurrentUserProfileInput,
  VerifyPasswordResetOtpInput
} from './auth.schema';
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

export interface PasswordResetStartResult {
  resetRequestId: string;
  expiresAt: Date;
  debugOtp?: string;
}

export interface PasswordResetVerifyResult {
  resetToken: string;
  resetTokenExpiresAt: Date;
}

const PASSWORD_RESET_OTP_DIGITS = 4;
const PASSWORD_RESET_EXPIRY_MINUTES = 15;
const PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 10;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const toSafeUser = (user: HydratedDocument<UserDocument> | null): SafeUser => {
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  return {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    contactNo: user.contactNo,
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

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

const generateOtp = (): string =>
  randomInt(0, 10 ** PASSWORD_RESET_OTP_DIGITS)
    .toString()
    .padStart(PASSWORD_RESET_OTP_DIGITS, '0');

const generateResetToken = (): string => randomBytes(32).toString('base64url');

const generateNonce = (): string => randomBytes(16).toString('base64url');

const hashResetSecret = (value: string, nonce: string): string =>
  createHmac('sha256', env.JWT_REFRESH_SECRET).update(`${nonce}:${value}`).digest('hex');

const secretsMatch = (expectedHash: string, value: string, nonce: string): boolean => {
  const actualHash = hashResetSecret(value, nonce);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(actualHash, 'hex');

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const fakeResetRequestId = (): string => randomBytes(12).toString('hex');

const isEligibleForPasswordReset = (
  user: HydratedDocument<UserDocument>,
  audience: PasswordResetAudience
): boolean => {
  if (user.status !== 'active') {
    return false;
  }

  return audience === 'admin' ? isAdminRole(user.role) : isPublicRole(user.role);
};

const resetRequestExpired = (expiresAt?: Date): boolean =>
  !expiresAt || expiresAt.getTime() <= Date.now();

const writePasswordResetOutbox = async (input: {
  requestId: string;
  email: string;
  fullName: string;
  otp: string;
  expiresAt: Date;
}): Promise<string> => {
  await mkdir(env.AUTH_RESET_OUTBOX_PATH, { recursive: true });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${input.requestId}.json`;
  const outboxPath = path.join(env.AUTH_RESET_OUTBOX_PATH, fileName);

  await writeFile(
    outboxPath,
    JSON.stringify(
      {
        type: 'password_reset_otp',
        to: input.email,
        subject: 'SafeSpeak password reset code',
        text: `Hello ${input.fullName}, your SafeSpeak password reset code is ${input.otp}. It expires at ${input.expiresAt.toISOString()}.`,
        otp: input.otp,
        expiresAt: input.expiresAt.toISOString(),
        requestId: input.requestId,
        createdAt: new Date().toISOString()
      },
      null,
      2
    )
  );

  return outboxPath;
};

const deliverPasswordResetOtp = async (input: {
  requestId: string;
  email: string;
  fullName: string;
  otp: string;
  expiresAt: Date;
}): Promise<{ mode: 'webhook' | 'development_outbox'; reference?: string }> => {
  if (env.AUTH_RESET_EMAIL_WEBHOOK_URL) {
    const response = await fetch(env.AUTH_RESET_EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AUTH_RESET_EMAIL_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${env.AUTH_RESET_EMAIL_WEBHOOK_TOKEN}` }
          : {})
      },
      body: JSON.stringify({
        type: 'password_reset_otp',
        to: input.email,
        subject: 'SafeSpeak password reset code',
        text: `Hello ${input.fullName}, your SafeSpeak password reset code is ${input.otp}. It expires at ${input.expiresAt.toISOString()}.`,
        otp: input.otp,
        expiresAt: input.expiresAt.toISOString(),
        requestId: input.requestId
      })
    });

    if (!response.ok) {
      throw new ApiError(StatusCodes.BAD_GATEWAY, 'Password reset email could not be queued');
    }

    return { mode: 'webhook' };
  }

  if (env.NODE_ENV === 'production') {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Password reset delivery is not configured');
  }

  return {
    mode: 'development_outbox',
    reference: await writePasswordResetOutbox(input)
  };
};

const auditPasswordReset = async (
  action: string,
  input: {
    user?: HydratedDocument<UserDocument>;
    audience: PasswordResetAudience;
    resourceId?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> => {
  await createAuditLog({
    actorType: input.user ? (isAdminRole(input.user.role) ? 'admin' : 'user') : 'system',
    actorId: input.user?._id,
    action,
    resourceType: 'auth',
    resourceId: input.resourceId,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      audience: input.audience,
      ...input.metadata
    }
  });
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

export const changeUserPassword = async (
  userId: string,
  input: ChangePasswordInput,
  ip?: string,
  userAgent?: string
): Promise<SafeUser> => {
  const user = await UserModel.findById(userId).select('+passwordHash');

  if (!user || user.status !== 'active') {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid authentication token');
  }

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Current password is incorrect');
  }

  user.passwordHash = await hashPassword(input.newPassword);
  await user.save();

  const safeUser = toSafeUser(user);

  await createAuditLog({
    actorType: isAdminRole(safeUser.role) ? 'admin' : 'user',
    actorId: safeUser.id,
    action: 'auth.change_password',
    resourceType: 'auth',
    resourceId: safeUser.id,
    ip,
    userAgent
  });

  return safeUser;
};

export const updateCurrentUserProfile = async (
  userId: string,
  input: UpdateCurrentUserProfileInput,
  ip?: string,
  userAgent?: string
): Promise<SafeUser> => {
  const user = await UserModel.findById(userId);

  if (!user || user.status !== 'active') {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid authentication token');
  }

  const changedFields: string[] = [];

  if (input.fullName !== undefined && input.fullName !== user.fullName) {
    user.fullName = input.fullName;
    changedFields.push('fullName');
  }

  if (input.email !== undefined) {
    const nextEmail = input.email.toLowerCase();

    if (nextEmail !== user.email) {
      const existingUser = await UserModel.findOne({
        email: nextEmail,
        _id: { $ne: user._id }
      }).select('_id');

      if (existingUser) {
        throw new ApiError(StatusCodes.CONFLICT, 'Email is already registered');
      }

      user.email = nextEmail;
      changedFields.push('email');
    }
  }

  if (input.contactNo !== undefined && input.contactNo !== (user.contactNo ?? '')) {
    user.contactNo = input.contactNo;
    changedFields.push('contactNo');
  }

  if (changedFields.length > 0) {
    await user.save();
  }

  const safeUser = toSafeUser(user);

  await createAuditLog({
    actorType: isAdminRole(safeUser.role) ? 'admin' : 'user',
    actorId: safeUser.id,
    action: 'auth.profile.update',
    resourceType: 'auth',
    resourceId: safeUser.id,
    ip,
    userAgent,
    metadata: {
      changedFields
    }
  });

  return safeUser;
};

export const requestPasswordReset = async (
  input: ForgotPasswordInput,
  ip?: string,
  userAgent?: string
): Promise<PasswordResetStartResult> => {
  const email = input.email.toLowerCase();
  const audience = input.audience;
  const expiresAt = minutesFromNow(PASSWORD_RESET_EXPIRY_MINUTES);

  if (env.NODE_ENV === 'production' && !env.AUTH_RESET_EMAIL_WEBHOOK_URL) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Password reset delivery is not configured');
  }

  const user = await UserModel.findOne({ email }).select('+passwordHash');

  if (!user || !isEligibleForPasswordReset(user, audience)) {
    await auditPasswordReset('auth.password_reset.request_ignored', {
      audience,
      ip,
      userAgent,
      metadata: {
        reason: 'ineligible_or_missing_account'
      }
    });

    return {
      resetRequestId: fakeResetRequestId(),
      expiresAt
    };
  }

  await PasswordResetRequestModel.updateMany(
    {
      userId: user._id,
      audience,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() }
    },
    {
      $set: {
        expiresAt: new Date()
      }
    }
  );

  const otp = generateOtp();
  const otpNonce = generateNonce();
  const request = await PasswordResetRequestModel.create({
    userId: user._id,
    email,
    audience,
    otpHash: hashResetSecret(otp, otpNonce),
    otpNonce,
    otpAttempts: 0,
    maxOtpAttempts: PASSWORD_RESET_MAX_ATTEMPTS,
    expiresAt
  });
  const delivery = await deliverPasswordResetOtp({
    requestId: request._id.toString(),
    email,
    fullName: user.fullName,
    otp,
    expiresAt
  });

  request.deliveredAt = new Date();
  request.deliveryMode = delivery.mode;
  request.deliveryReference = delivery.reference;
  await request.save();

  await auditPasswordReset('auth.password_reset.request', {
    user,
    audience,
    resourceId: request._id.toString(),
    ip,
    userAgent,
    metadata: {
      deliveryMode: delivery.mode
    }
  });

  return {
    resetRequestId: request._id.toString(),
    expiresAt,
    ...(env.NODE_ENV === 'production' ? {} : { debugOtp: otp })
  };
};

export const verifyPasswordResetOtp = async (
  input: VerifyPasswordResetOtpInput,
  ip?: string,
  userAgent?: string
): Promise<PasswordResetVerifyResult> => {
  const request = await PasswordResetRequestModel.findOne({
    _id: input.resetRequestId,
    email: input.email.toLowerCase(),
    audience: input.audience
  }).select('+otpHash +otpNonce');

  if (
    !request ||
    request.usedAt ||
    resetRequestExpired(request.expiresAt) ||
    request.otpAttempts >= request.maxOtpAttempts
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or expired verification code');
  }

  request.otpAttempts += 1;

  if (!secretsMatch(request.otpHash, input.otp, request.otpNonce)) {
    if (request.otpAttempts >= request.maxOtpAttempts) {
      request.expiresAt = new Date();
    }

    await request.save();
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or expired verification code');
  }

  const resetToken = generateResetToken();
  const resetTokenNonce = generateNonce();
  const resetTokenExpiresAt = minutesFromNow(PASSWORD_RESET_TOKEN_EXPIRY_MINUTES);
  const user = await UserModel.findById(request.userId);

  request.verifiedAt = new Date();
  request.resetTokenHash = hashResetSecret(resetToken, resetTokenNonce);
  request.resetTokenNonce = resetTokenNonce;
  request.resetTokenExpiresAt = resetTokenExpiresAt;
  await request.save();

  await auditPasswordReset('auth.password_reset.verify_otp', {
    user: user ?? undefined,
    audience: input.audience,
    resourceId: request._id.toString(),
    ip,
    userAgent,
    metadata: {
      attempts: request.otpAttempts
    }
  });

  return {
    resetToken,
    resetTokenExpiresAt
  };
};

export const resetUserPasswordWithToken = async (
  input: ResetPasswordInput,
  ip?: string,
  userAgent?: string
): Promise<void> => {
  const request = await PasswordResetRequestModel.findOne({
    _id: input.resetRequestId,
    email: input.email.toLowerCase(),
    audience: input.audience
  }).select('+resetTokenHash +resetTokenNonce');

  if (
    !request ||
    request.usedAt ||
    resetRequestExpired(request.expiresAt) ||
    !request.verifiedAt ||
    !request.resetTokenHash ||
    !request.resetTokenNonce ||
    resetRequestExpired(request.resetTokenExpiresAt) ||
    !secretsMatch(request.resetTokenHash, input.resetToken, request.resetTokenNonce)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or expired password reset session');
  }

  const user = await UserModel.findById(request.userId).select('+passwordHash +refreshTokenHash');

  if (!user || !isEligibleForPasswordReset(user, input.audience)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or expired password reset session');
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.refreshTokenHash = undefined;
  await user.save();

  request.usedAt = new Date();
  await request.save();

  await PasswordResetRequestModel.updateMany(
    {
      userId: user._id,
      audience: input.audience,
      usedAt: { $exists: false },
      _id: { $ne: request._id }
    },
    {
      $set: {
        expiresAt: new Date()
      }
    }
  );

  await auditPasswordReset('auth.password_reset.complete', {
    user,
    audience: input.audience,
    resourceId: request._id.toString(),
    ip,
    userAgent
  });
};

export const deactivateUserAccount = async (
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<SafeUser> => {
  const user = await UserModel.findByIdAndUpdate(
    userId,
    {
      status: 'inactive',
      $unset: {
        refreshTokenHash: ''
      }
    },
    {
      new: true
    }
  );

  const safeUser = toSafeUser(user);

  await createAuditLog({
    actorType: 'user',
    actorId: safeUser.id,
    action: 'auth.deactivate',
    resourceType: 'auth',
    resourceId: safeUser.id,
    ip,
    userAgent
  });

  return safeUser;
};

export const getSafeUserById = async (userId: string): Promise<SafeUser> => {
  const user = await UserModel.findById(userId);

  return toSafeUser(user);
};
