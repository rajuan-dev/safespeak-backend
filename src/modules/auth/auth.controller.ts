import type { Request, Response } from 'express';
import type { NextFunction, RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import passport from 'passport';

import { ApiError } from '@common/errors/ApiError';
import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';
import { env } from '@config/env';

import {
  getSafeUserById,
  loginUser,
  logoutUser,
  refreshUserToken,
  registerUser
} from './auth.service';
import type { AuthData } from './auth.types';
import { isGoogleOAuthConfigured, type GooglePassportUser } from './auth.passport';
import type { LoginInput, RefreshTokenInput, RegisterInput } from './auth.schema';

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

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  await logoutUser(req.user?.id);

  ApiResponse.success(res, 'Logout successful', null);
});

export const meController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication is required');
  }

  const user = await getSafeUserById(req.user.id);

  ApiResponse.success(res, 'Current user retrieved successfully', { user });
});

export const googleLoginController: RequestHandler = (req, res, next) => {
  if (!isGoogleOAuthConfigured()) {
    next(new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Google OAuth is not configured'));
    return;
  }

  passport.authenticate('google', {
    scope: googleOAuthScopes,
    session: false,
    prompt: 'select_account'
  })(req, res, next);
};

export const googleCallbackController = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!isGoogleOAuthConfigured()) {
    next(new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Google OAuth is not configured'));
    return;
  }

  passport.authenticate('google', { session: false }, (error: unknown, user?: Express.User) => {
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
  })(req, res, next);
};
