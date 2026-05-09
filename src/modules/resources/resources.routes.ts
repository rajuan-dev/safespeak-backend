import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminResourcesCreateController,
  adminResourcesDeleteController,
  adminResourcesListController,
  adminResourcesUpdateController,
  publicResourcesController
} from './resources.controller';
import {
  createResourceSchema,
  resourceAdminQuerySchema,
  resourceParamsSchema,
  updateResourceSchema
} from './resources.schema';

export const resourceRoutes = Router();
export const adminResourceRoutes = Router();

resourceRoutes.get('/', publicResourcesController);

adminResourceRoutes.use(authenticateUser, requireAdminRole());
adminResourceRoutes.get('/', validate({ query: resourceAdminQuerySchema }), adminResourcesListController);
adminResourceRoutes.post('/', validate({ body: createResourceSchema }), adminResourcesCreateController);
adminResourceRoutes.patch(
  '/:id',
  validate({ params: resourceParamsSchema, body: updateResourceSchema }),
  adminResourcesUpdateController
);
adminResourceRoutes.delete(
  '/:id',
  validate({ params: resourceParamsSchema }),
  adminResourcesDeleteController
);
