import { Router } from 'express';
import multer from 'multer';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';
import { env } from '@config/env';

import {
  adminMicroEducationCreateController,
  adminMicroEducationDeleteController,
  publicMicroEducationImageController,
  adminMicroEducationListController,
  adminMicroEducationUpdateController,
  publicMicroEducationController
} from './microeducation.controller';
import {
  createMicroEducationSchema,
  microEducationAdminQuerySchema,
  microEducationParamsSchema,
  updateMicroEducationSchema
} from './microeducation.schema';

export const microEducationRoutes = Router();
export const adminMicroEducationRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MICRO_EDUCATION_IMAGE_MAX_FILE_SIZE_BYTES,
    files: 1
  }
});

microEducationRoutes.get('/', publicMicroEducationController);
microEducationRoutes.get(
  '/:id/image',
  validate({ params: microEducationParamsSchema }),
  publicMicroEducationImageController
);

adminMicroEducationRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminMicroEducationRoutes.get(
  '/',
  validate({ query: microEducationAdminQuerySchema }),
  adminMicroEducationListController
);
adminMicroEducationRoutes.post(
  '/',
  upload.single('image'),
  validate({ body: createMicroEducationSchema }),
  adminMicroEducationCreateController
);
adminMicroEducationRoutes.patch(
  '/:id',
  upload.single('image'),
  validate({ params: microEducationParamsSchema, body: updateMicroEducationSchema }),
  adminMicroEducationUpdateController
);
adminMicroEducationRoutes.delete(
  '/:id',
  validate({ params: microEducationParamsSchema }),
  adminMicroEducationDeleteController
);
