import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import {
  convertSessionToUser,
  createAnonymousSession,
  getSessionByToken
} from './sessions.service';
import type { CreateAnonymousSessionInput } from './sessions.schema';

export const createAnonymousSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = req.body as unknown as CreateAnonymousSessionInput;
    const result = await createAnonymousSession(input, req.ip, req.get('user-agent'));

    ApiResponse.created(res, 'Anonymous session created', result);
  }
);

export const getCurrentSessionController = asyncHandler(async (req: Request, res: Response) => {
  const sessionToken = req.get('X-SafeSpeak-Session');
  const session = sessionToken ? await getSessionByToken(sessionToken) : req.session;

  ApiResponse.success(res, 'Current session retrieved', { session });
});

export const convertToUserController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.session) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Anonymous session is required');
  }

  const input = req.body as unknown as { userId: string };
  const session = await convertSessionToUser(
    req.session.id,
    input.userId,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Session converted to user', { session });
});
