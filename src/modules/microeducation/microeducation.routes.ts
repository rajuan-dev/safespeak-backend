import { Router } from 'express';
import multer from 'multer';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';
import { env } from '@config/env';

import {
  adminMicroEducationCategoryCreateController,
  adminMicroEducationCategoryDeleteController,
  adminMicroEducationCategoryListController,
  adminMicroEducationCategoryUpdateController,
  publicMicroEducationCategoryListController
} from './microeducation-category.controller';
import {
  createMicroEducationCategorySchema,
  microEducationCategoryParamsSchema,
  microEducationCategoryQuerySchema,
  updateMicroEducationCategorySchema
} from './microeducation-category.schema';
import {
  adminMicroEducationCreateController,
  adminMicroEducationDeleteController,
  adminMicroEducationGenerateController,
  publicMicroEducationImageController,
  adminMicroEducationListController,
  adminMicroEducationUpdateController,
  publicMicroEducationByCategoryController,
  publicMicroEducationController
} from './microeducation.controller';
import {
  createMicroEducationSchema,
  generateMicroEducationSchema,
  microEducationAdminQuerySchema,
  microEducationPublicQuerySchema,
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

microEducationRoutes.get(
  '/',
  validate({ query: microEducationPublicQuerySchema }),
  publicMicroEducationController
);
microEducationRoutes.get('/categories', publicMicroEducationCategoryListController);
microEducationRoutes.get(
  '/categories/:id/cards',
  validate({ params: microEducationCategoryParamsSchema }),
  publicMicroEducationByCategoryController
);
microEducationRoutes.get(
  '/:id/image',
  validate({ params: microEducationParamsSchema }),
  publicMicroEducationImageController
);

adminMicroEducationRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminMicroEducationRoutes.get(
  '/categories',
  validate({ query: microEducationCategoryQuerySchema }),
  adminMicroEducationCategoryListController
);
adminMicroEducationRoutes.post(
  '/generate',
  validate({ body: generateMicroEducationSchema }),
  adminMicroEducationGenerateController
);
adminMicroEducationRoutes.post(
  '/categories',
  validate({ body: createMicroEducationCategorySchema }),
  adminMicroEducationCategoryCreateController
);
adminMicroEducationRoutes.patch(
  '/categories/:id',
  validate({
    params: microEducationCategoryParamsSchema,
    body: updateMicroEducationCategorySchema
  }),
  adminMicroEducationCategoryUpdateController
);
adminMicroEducationRoutes.delete(
  '/categories/:id',
  validate({ params: microEducationCategoryParamsSchema }),
  adminMicroEducationCategoryDeleteController
);
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
