import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';

import {
  getPublicCulturalProfilesController,
  getScopeBlueprintController,
  getScopeBootstrapController
} from './scope.controller';

export const scopeRoutes = Router();

scopeRoutes.get('/bootstrap', getScopeBootstrapController);
scopeRoutes.get('/cultural-profiles', getPublicCulturalProfilesController);
scopeRoutes.get('/blueprint', authenticateUser, requireAdminRole(), getScopeBlueprintController);
