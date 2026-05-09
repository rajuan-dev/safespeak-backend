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
    files: 1
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

adminContentResourceRoutes.use(authenticateUser, requireAdminRole());
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
  upload.single('file'),
  validate({ body: createContentResourceSchema }),
  adminContentResourceCreateController
);
adminContentResourceRoutes.patch(
  '/:id',
  upload.single('file'),
  validate({ params: contentResourceParamsSchema, body: updateContentResourceSchema }),
  adminContentResourceUpdateController
);
adminContentResourceRoutes.delete(
  '/:id',
  validate({ params: contentResourceParamsSchema }),
  adminContentResourceDeleteController
);
