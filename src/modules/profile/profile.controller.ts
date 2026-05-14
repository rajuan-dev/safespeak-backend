import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

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

  ApiResponse.success(res, 'Profile retrieved', { profile });
});

export const updateProfileController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as UpdateProfileInput;
  const profile = await updateProfile(getOwner(req), input, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Profile updated', { profile });
});

export const getLanguagesController = asyncHandler(async (_req: Request, res: Response) => {
  const languages = await getLanguageOptions();

  ApiResponse.success(res, 'Languages retrieved', { languages });
});

export const getCulturalProfilesController = asyncHandler(async (_req: Request, res: Response) => {
  const culturalProfiles = await getCulturalProfileOptions();

  ApiResponse.success(res, 'Cultural profiles retrieved', {
    culturalProfiles
  });
});

export const getFaithProfilesController = asyncHandler(async (_req: Request, res: Response) => {
  const faithProfiles = await getFaithProfileOptions();

  ApiResponse.success(res, 'Faith profiles retrieved', {
    faithProfiles
  });
});

export const getCommunityProfilesController = asyncHandler(async (_req: Request, res: Response) => {
  const communityProfiles = await getCommunityProfileOptions();

  ApiResponse.success(res, 'Community profiles retrieved', {
    communityProfiles
  });
});
