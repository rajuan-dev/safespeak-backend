import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  ContentPageParamsInput,
  ContentPageUpdateInput
} from './content-pages.schema';
import {
  getAdminContentPage,
  getPublicContentPage,
  saveAdminContentPage
} from './content-pages.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicContentPageController = asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.params as unknown as ContentPageParamsInput;
  const contentPage = await getPublicContentPage(getContext(req), key);

  res.status(StatusCodes.OK).json(successResponse('Content page retrieved', { contentPage }));
});

export const adminContentPageController = asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.params as unknown as ContentPageParamsInput;
  const contentPage = await getAdminContentPage(getContext(req), key);

  res.status(StatusCodes.OK).json(successResponse('Admin content page retrieved', { contentPage }));
});

export const adminContentPageSaveController = asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.params as unknown as ContentPageParamsInput;
  const contentPage = await saveAdminContentPage(
    getContext(req),
    key,
    req.body as ContentPageUpdateInput
  );

  res.status(StatusCodes.OK).json(successResponse('Content page saved', { contentPage }));
});
