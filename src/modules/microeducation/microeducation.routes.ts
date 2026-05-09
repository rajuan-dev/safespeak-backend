import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminMicroEducationCreateController,
  adminMicroEducationDeleteController,
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

microEducationRoutes.get('/', publicMicroEducationController);

adminMicroEducationRoutes.use(authenticateUser, requireAdminRole());
adminMicroEducationRoutes.get(
  '/',
  validate({ query: microEducationAdminQuerySchema }),
  adminMicroEducationListController
);
adminMicroEducationRoutes.post(
  '/',
  validate({ body: createMicroEducationSchema }),
  adminMicroEducationCreateController
);
adminMicroEducationRoutes.patch(
  '/:id',
  validate({ params: microEducationParamsSchema, body: updateMicroEducationSchema }),
  adminMicroEducationUpdateController
);
adminMicroEducationRoutes.delete(
  '/:id',
  validate({ params: microEducationParamsSchema }),
  adminMicroEducationDeleteController
);
