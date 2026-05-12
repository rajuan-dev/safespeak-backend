import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type { UpdatePlatformSettingsDraftInput } from './platform-settings.schema';
import {
  getAdminPlatformSettings,
  getPublicPlatformSettings,
  publishPlatformSettingsDraft,
  updatePlatformSettingsDraft
} from './platform-settings.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicPlatformSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const platformSettings = await getPublicPlatformSettings(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Platform settings retrieved', { platformSettings }));
  }
);

export const adminPlatformSettingsController = asyncHandler(async (req: Request, res: Response) => {
  const platformSettings = await getAdminPlatformSettings(getContext(req));

  res
    .status(StatusCodes.OK)
    .json(successResponse('Admin platform settings retrieved', { platformSettings }));
});

export const adminPlatformSettingsDraftUpdateController = asyncHandler(
  async (req: Request, res: Response) => {
    const platformSettings = await updatePlatformSettingsDraft(
      getContext(req),
      req.body as UpdatePlatformSettingsDraftInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Platform settings draft updated', { platformSettings }));
  }
);

export const adminPlatformSettingsPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const platformSettings = await publishPlatformSettingsDraft(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Platform settings published', { platformSettings }));
  }
);
