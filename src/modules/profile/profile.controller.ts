import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import {
  getCommunityProfileOptions,
  getCulturalProfileOptions,
  getFaithProfileOptions,
  getLanguageOptions,
  getProfile,
  updateProfile
} from './profile.service';
import type { UpdateProfileInput } from './profile.schema';

const getOwner = (req: Request) => ({
  userId: req.user?.id,
  sessionId: req.session?.id
});

export const getProfileController = asyncHandler(async (req: Request, res: Response) => {
  const profile = await getProfile(getOwner(req));

  res.status(StatusCodes.OK).json(successResponse('Profile retrieved', { profile }));
});

export const updateProfileController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as UpdateProfileInput;
  const profile = await updateProfile(getOwner(req), input, req.ip, req.get('user-agent'));

  res.status(StatusCodes.OK).json(successResponse('Profile updated', { profile }));
});

export const getLanguagesController = (_req: Request, res: Response): void => {
  res
    .status(StatusCodes.OK)
    .json(successResponse('Languages retrieved', { languages: getLanguageOptions() }));
};

export const getCulturalProfilesController = (_req: Request, res: Response): void => {
  res.status(StatusCodes.OK).json(
    successResponse('Cultural profiles retrieved', {
      culturalProfiles: getCulturalProfileOptions()
    })
  );
};

export const getFaithProfilesController = (_req: Request, res: Response): void => {
  res
    .status(StatusCodes.OK)
    .json(successResponse('Faith profiles retrieved', { faithProfiles: getFaithProfileOptions() }));
};

export const getCommunityProfilesController = (_req: Request, res: Response): void => {
  res.status(StatusCodes.OK).json(
    successResponse('Community profiles retrieved', {
      communityProfiles: getCommunityProfileOptions()
    })
  );
};
