import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import {
  getConsentHistory,
  getCurrentConsent,
  updateConsent,
  withdrawConsent
} from './consent.service';
import type { UpdateConsentInput, WithdrawConsentInput } from './consent.schema';

const getOwner = (req: Request) => ({
  userId: req.user?.id,
  sessionId: req.session?.id
});

export const getCurrentConsentController = asyncHandler(async (req: Request, res: Response) => {
  const consent = await getCurrentConsent(getOwner(req));

  res.status(StatusCodes.OK).json(successResponse('Current consent retrieved', { consent }));
});

export const updateConsentController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as UpdateConsentInput;
  const consent = await updateConsent(getOwner(req), input, req.ip, req.get('user-agent'));

  res.status(StatusCodes.OK).json(successResponse('Consent updated', { consent }));
});

export const withdrawConsentController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as WithdrawConsentInput;
  const consent = await withdrawConsent(getOwner(req), input, req.ip, req.get('user-agent'));

  res.status(StatusCodes.OK).json(successResponse('Consent withdrawn', { consent }));
});

export const getConsentHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const history = await getConsentHistory(getOwner(req));

  res.status(StatusCodes.OK).json(successResponse('Consent history retrieved', { history }));
});
