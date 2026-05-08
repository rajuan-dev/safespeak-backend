import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import {
  getSafeUserById,
  loginUser,
  logoutUser,
  refreshUserToken,
  registerUser
} from './auth.service';
import type { LoginInput, RefreshTokenInput, RegisterInput } from './auth.schema';

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
