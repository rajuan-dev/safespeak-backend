import type { Request, Response } from 'express';
import type { NextFunction, RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import passport from 'passport';

import { ApiError } from '@common/errors/ApiError';
import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';
import { env } from '@config/env';

import {
  changeUserPassword,
  deactivateUserAccount,
  getSafeUserById,
  loginUser,
  logoutUser,
  refreshUserToken,
  registerUser,
  requestPasswordReset,
  resetUserPasswordWithToken,
  updateCurrentUserProfile,
  verifyPasswordResetOtp
} from './auth.service';
import type { AuthData } from './auth.types';
import {
  getGoogleOAuthMissingConfig,
  isGoogleOAuthConfigured,
  type GooglePassportUser
} from './auth.passport';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateCurrentUserProfileInput,
  VerifyPasswordResetOtpInput
} from './auth.schema';

const googleOAuthScopes = ['profile', 'email'];

const buildClientUrl = (path: string): URL => new URL(path, env.CLIENT_URL);

const redirectToGoogleAuthError = (res: Response, message: string): void => {
  const url = buildClientUrl('/login');

  url.searchParams.set('authError', message);
  res.redirect(url.toString());
};

const encodeAuthData = (authData: AuthData): string =>
  Buffer.from(JSON.stringify(authData)).toString('base64url');

const redirectToClientAuthCallback = (res: Response, authData: AuthData): void => {
  const url = buildClientUrl('/auth/callback');

  url.hash = new URLSearchParams({
    auth: encodeAuthData(authData)
  }).toString();

  res.redirect(url.toString());
};

const createGoogleOAuthConfigError = (): ApiError => {
  const missingConfig = getGoogleOAuthMissingConfig();
  const message =
    missingConfig.length > 0
      ? `Google OAuth is not configured. Missing: ${missingConfig.join(', ')}`
      : 'Google OAuth is not configured';

  return new ApiError(StatusCodes.SERVICE_UNAVAILABLE, message);
};

export const registerController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as RegisterInput;
  const result = await registerUser(input, req.ip, req.get('user-agent'));

  ApiResponse.created(res, 'User registered successfully', result);
});

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as LoginInput;
  const result = await loginUser(input, false, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Login successful', result);
});

export const adminLoginController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as LoginInput;
  const result = await loginUser(input, true, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Admin login successful', result);
});

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as RefreshTokenInput;
  const result = await refreshUserToken(input.refreshToken);

  ApiResponse.success(res, 'Token refreshed successfully', result);
});

export const forgotPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as ForgotPasswordInput;
  const result = await requestPasswordReset(input, req.ip, req.get('user-agent'));

  ApiResponse.success(
    res,
    'If an eligible account exists, a verification code has been sent',
    result
  );
});

export const verifyPasswordResetOtpController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = req.body as unknown as VerifyPasswordResetOtpInput;
    const result = await verifyPasswordResetOtp(input, req.ip, req.get('user-agent'));

    ApiResponse.success(res, 'Verification code accepted', result);
  }
);

export const resetPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as ResetPasswordInput;

  await resetUserPasswordWithToken(input, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Password reset successfully', null);
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  await logoutUser(req.user?.id);

  ApiResponse.success(res, 'Logout successful', null);
});

export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication is required');
  }

  const input = req.body as unknown as ChangePasswordInput;
  const user = await changeUserPassword(
    req.user.id,
    input,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Password updated successfully', { user });
});

export const meController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication is required');
  }

  const user = await getSafeUserById(req.user.id);

  ApiResponse.success(res, 'Current user retrieved successfully', { user });
});

export const updateMeController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication is required');
  }

  const body = req.body as Partial<Record<keyof UpdateCurrentUserProfileInput, string>>;
  const input: UpdateCurrentUserProfileInput = {};

  if (body.fullName !== undefined) {
    input.fullName = body.fullName;
  }

  if (body.email !== undefined) {
    input.email = body.email;
  }

  if (body.contactNo !== undefined) {
    input.contactNo = body.contactNo;
  }

  const user = await updateCurrentUserProfile(req.user.id, input, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Current user updated successfully', { user });
});

export const deactivateController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication is required');
  }

  const user = await deactivateUserAccount(req.user.id, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Account deactivated', { user });
});

export const googleLoginController: RequestHandler = (req, res, next) => {
  if (!isGoogleOAuthConfigured()) {
    next(createGoogleOAuthConfigError());
    return;
  }

  const authenticate = passport.authenticate('google', {
    scope: googleOAuthScopes,
    session: false,
    prompt: 'select_account'
  }) as RequestHandler;

  authenticate(req, res, next);
};

export const googleCallbackController = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!isGoogleOAuthConfigured()) {
    next(createGoogleOAuthConfigError());
    return;
  }

  const authenticate = passport.authenticate('google', { session: false }, (error: unknown, user?: Express.User) => {
    if (error) {
      redirectToGoogleAuthError(res, 'Google sign-in failed. Please try again.');
      return;
    }

    const authData = (user as GooglePassportUser | undefined)?.authData;

    if (!authData) {
      redirectToGoogleAuthError(res, 'Google sign-in was cancelled or could not be completed.');
      return;
    }

    redirectToClientAuthCallback(res, authData);
  }) as RequestHandler;

  authenticate(req, res, next);
};
