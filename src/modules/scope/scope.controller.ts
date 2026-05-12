import type { Request, Response } from 'express';

import { ApiResponse } from '@common/responses/api-response';

import { getScopeBlueprint, getScopeBootstrap } from './scope.service';

export const getScopeBootstrapController = (_req: Request, res: Response): void => {
  ApiResponse.success(res, 'Scope bootstrap retrieved', { bootstrap: getScopeBootstrap() });
};

export const getScopeBlueprintController = (_req: Request, res: Response): void => {
  ApiResponse.success(res, 'Scope blueprint retrieved', { blueprint: getScopeBlueprint() });
};
