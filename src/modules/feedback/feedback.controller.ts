import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  AdminFeedbackQueryInput,
  FeedbackSubmissionInput,
  UpdateAdminFeedbackInput
} from './feedback.schema';
import { createFeedback, listAdminFeedback, updateAdminFeedback } from './feedback.service';

const getContext = (req: Request) => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

const getAdminContext = (req: Request) => ({
  adminUserId: req.user?.id ?? '',
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const createFeedbackController = asyncHandler(async (req: Request, res: Response) => {
  const feedback = await createFeedback(getContext(req), req.body as FeedbackSubmissionInput);

  res.status(StatusCodes.CREATED).json(successResponse('Feedback submitted', { feedback }));
});

export const listAdminFeedbackController = asyncHandler(async (req: Request, res: Response) => {
  const feedback = await listAdminFeedback(
    getAdminContext(req),
    req.query as unknown as AdminFeedbackQueryInput
  );

  res.status(StatusCodes.OK).json(successResponse('Admin feedback retrieved', { feedback }));
});

export const updateAdminFeedbackController = asyncHandler(async (req: Request, res: Response) => {
  const feedback = await updateAdminFeedback(
    getAdminContext(req),
    req.params.id,
    req.body as UpdateAdminFeedbackInput
  );

  res.status(StatusCodes.OK).json(successResponse('Admin feedback updated', { feedback }));
});
