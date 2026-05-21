import { Router } from 'express';
import multer from 'multer';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';
import { env } from '@config/env';

import {
  adminContentResourceCreateController,
  adminContentResourceDeleteController,
  adminContentResourceDetailController,
  adminContentResourcesListController,
  adminContentResourceUpdateController,
  publicContentResourceDownloadController,
  publicContentResourceImageController,
  publicContentResourcesListController
} from './content-resources.controller';
import {
  contentResourceParamsSchema,
  contentResourceQuerySchema,
  createContentResourceSchema,
  updateContentResourceSchema
} from './content-resources.schema';

export const contentResourceRoutes = Router();
export const adminContentResourceRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.CONTENT_RESOURCE_MAX_FILE_SIZE_BYTES,
    files: 2
  }
});

contentResourceRoutes.get(
  '/',
  validate({ query: contentResourceQuerySchema }),
  publicContentResourcesListController
);
contentResourceRoutes.get(
  '/:id/download',
  validate({ params: contentResourceParamsSchema }),
  publicContentResourceDownloadController
);
contentResourceRoutes.get(
  '/:id/image',
  validate({ params: contentResourceParamsSchema }),
  publicContentResourceImageController
);

adminContentResourceRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminContentResourceRoutes.get(
  '/',
  validate({ query: contentResourceQuerySchema }),
  adminContentResourcesListController
);
adminContentResourceRoutes.get(
  '/:id',
  validate({ params: contentResourceParamsSchema }),
  adminContentResourceDetailController
);
adminContentResourceRoutes.post(
  '/',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ]),
  validate({ body: createContentResourceSchema }),
  adminContentResourceCreateController
);
adminContentResourceRoutes.patch(
  '/:id',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ]),
  validate({ params: contentResourceParamsSchema, body: updateContentResourceSchema }),
  adminContentResourceUpdateController
);
adminContentResourceRoutes.delete(
  '/:id',
  validate({ params: contentResourceParamsSchema }),
  adminContentResourceDeleteController
);
