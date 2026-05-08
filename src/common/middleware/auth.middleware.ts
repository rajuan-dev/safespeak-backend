import type { Request, RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { asyncHandler } from '@common/errors/asyncHandler';
import { UserModel } from '@modules/auth/auth.model';
import { verifyAccessToken } from '@modules/auth/auth.utils';
import type { UserRole } from '@modules/rbac/rbac.types';
import { canAccessAdmin } from '@modules/rbac/rbac.utils';
import { SAFE_SPEAK_SESSION_HEADER } from '@modules/sessions/sessions.constants';
import { getSessionByToken } from '@modules/sessions/sessions.service';

const getBearerToken = (req: Request): string | undefined => {
  const authorization = req.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }

  return authorization.slice('Bearer '.length);
};

const setUserFromBearerToken = async (req: Request, token: string): Promise<void> => {
  const payload = verifyAccessToken(token);
  const user = await UserModel.findById(payload.userId);

  if (!user || user.status !== 'active') {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid authentication token');
  }

  req.user = {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status
  };
};

export const optionalAuthenticateUser: RequestHandler = asyncHandler(async (req, _res, next) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      next();
      return;
    }

    await setUserFromBearerToken(req, token);

    next();
  } catch {
    next();
  }
});

export const authenticateUser: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = getBearerToken(req);

  if (!token) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication token is required');
  }

  await setUserFromBearerToken(req, token);
  next();
});

export const authenticateSessionOrUser: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = getBearerToken(req);

  if (token) {
    await setUserFromBearerToken(req, token);
    next();
    return;
  }

  const sessionToken = req.get(SAFE_SPEAK_SESSION_HEADER);

  if (!sessionToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  req.session = await getSessionByToken(sessionToken);
  next();
});

export const requireRoles =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new ApiError(StatusCodes.FORBIDDEN, 'Insufficient permissions'));
      return;
    }

    next();
  };

export const requireAdminRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !canAccessAdmin(req.user.role)) {
      next(new ApiError(StatusCodes.FORBIDDEN, 'Admin permissions are required'));
      return;
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      next(new ApiError(StatusCodes.FORBIDDEN, 'Insufficient admin permissions'));
      return;
    }

    next();
  };
