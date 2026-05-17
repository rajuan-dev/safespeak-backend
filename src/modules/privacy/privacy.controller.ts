import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import {
  createDeletionRequest,
  createPrivacyRequest,
  getOwnPrivacyRequest,
  getPrivacyExport,
  listOwnPrivacyRequests
} from './privacy.service';
import type { CreatePrivacyRequestInput, DeleteRequestInput } from './privacy.schema';

const getContext = (req: Request) => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const createPrivacyRequestController = asyncHandler(
  async (req: Request, res: Response) => {
    const request = await createPrivacyRequest(
      getContext(req),
      req.body as CreatePrivacyRequestInput
    );

    ApiResponse.created(res, 'Privacy request created', { request });
  }
);

export const listOwnPrivacyRequestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const requests = await listOwnPrivacyRequests(getContext(req));

    ApiResponse.success(res, 'Privacy requests retrieved', { requests });
  }
);

export const getOwnPrivacyRequestController = asyncHandler(
  async (req: Request, res: Response) => {
    const request = await getOwnPrivacyRequest(getContext(req), req.params.id);

    ApiResponse.success(res, 'Privacy request retrieved', { request });
  }
);

export const privacyExportController = asyncHandler(async (req: Request, res: Response) => {
  const exportPayload = await getPrivacyExport(getContext(req));

  ApiResponse.success(res, 'Privacy export generated', { export: exportPayload });
});

export const deletionRequestController = asyncHandler(async (req: Request, res: Response) => {
  const request = await createDeletionRequest(getContext(req), req.body as DeleteRequestInput);

  ApiResponse.created(res, 'Deletion request created', { request });
});
