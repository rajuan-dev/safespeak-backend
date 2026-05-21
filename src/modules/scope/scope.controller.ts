import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import {
  getPublicCulturalProfileGuidance,
  getScopeBlueprint,
  getScopeBootstrap
} from './scope.service';

export const getScopeBootstrapController = asyncHandler(async (_req: Request, res: Response) => {
  const bootstrap = await getScopeBootstrap();

  ApiResponse.success(res, 'Scope bootstrap retrieved', { bootstrap });
});

export const getScopeBlueprintController = asyncHandler(async (_req: Request, res: Response) => {
  const blueprint = await getScopeBlueprint();

  ApiResponse.success(res, 'Scope blueprint retrieved', { blueprint });
});

export const getPublicCulturalProfilesController = asyncHandler(
  async (_req: Request, res: Response) => {
    const culturalProfiles = await getPublicCulturalProfileGuidance();

    ApiResponse.success(res, 'Public cultural profiles retrieved', { culturalProfiles });
  }
);
