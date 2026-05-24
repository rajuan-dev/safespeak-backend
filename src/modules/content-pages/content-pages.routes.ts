import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminContentPageController,
  adminContentPagePublishController,
  adminContentPageSaveController,
  publicContentPageController
} from './content-pages.controller';
import {
  contentPagePublishSchema,
  contentPageParamsSchema,
  contentPageUpdateSchema
} from './content-pages.schema';

export const contentPageRoutes = Router();
export const adminContentPageRoutes = Router();

contentPageRoutes.get(
  '/:key',
  validate({ params: contentPageParamsSchema }),
  publicContentPageController
);

adminContentPageRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminContentPageRoutes.get(
  '/:key',
  validate({ params: contentPageParamsSchema }),
  adminContentPageController
);
adminContentPageRoutes.patch(
  '/:key',
  validate({ params: contentPageParamsSchema, body: contentPageUpdateSchema }),
  adminContentPageSaveController
);
adminContentPageRoutes.post(
  '/:key/publish',
  validate({ params: contentPageParamsSchema, body: contentPagePublishSchema }),
  adminContentPagePublishController
);
