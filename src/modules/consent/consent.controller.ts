import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

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

  ApiResponse.success(res, 'Current consent retrieved', { consent });
});

export const updateConsentController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as UpdateConsentInput;
  const consent = await updateConsent(getOwner(req), input, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Consent updated', { consent });
});

export const withdrawConsentController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as WithdrawConsentInput;
  const consent = await withdrawConsent(getOwner(req), input, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Consent withdrawn', { consent });
});

export const getConsentHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const history = await getConsentHistory(getOwner(req));

  ApiResponse.success(res, 'Consent history retrieved', { history });
});
