import { Router } from 'express';
import multer from 'multer';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';
import { env } from '@config/env';

import {
  adminMediaAssetCreateController,
  adminMediaAssetDeleteController,
  adminMediaAssetDetailController,
  adminMediaAssetsListController,
  adminMediaAssetUpdateController,
  publicMediaAssetFileController,
  publicMediaAssetsListController
} from './media-assets.controller';
import {
  createMediaAssetSchema,
  mediaAssetParamsSchema,
  mediaAssetQuerySchema,
  updateMediaAssetSchema
} from './media-assets.schema';

export const mediaAssetRoutes = Router();
export const adminMediaAssetRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MEDIA_ASSET_MAX_FILE_SIZE_BYTES,
    files: 1
  }
});

mediaAssetRoutes.get('/', validate({ query: mediaAssetQuerySchema }), publicMediaAssetsListController);
mediaAssetRoutes.get(
  '/:id/file',
  validate({ params: mediaAssetParamsSchema }),
  publicMediaAssetFileController
);

adminMediaAssetRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminMediaAssetRoutes.get(
  '/',
  validate({ query: mediaAssetQuerySchema }),
  adminMediaAssetsListController
);
adminMediaAssetRoutes.get(
  '/:id',
  validate({ params: mediaAssetParamsSchema }),
  adminMediaAssetDetailController
);
adminMediaAssetRoutes.post(
  '/',
  upload.single('file'),
  validate({ body: createMediaAssetSchema }),
  adminMediaAssetCreateController
);
adminMediaAssetRoutes.patch(
  '/:id',
  upload.single('file'),
  validate({ params: mediaAssetParamsSchema, body: updateMediaAssetSchema }),
  adminMediaAssetUpdateController
);
adminMediaAssetRoutes.delete(
  '/:id',
  validate({ params: mediaAssetParamsSchema }),
  adminMediaAssetDeleteController
);
