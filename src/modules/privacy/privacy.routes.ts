import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  createPrivacyRequestController,
  deletionRequestController,
  getOwnPrivacyRequestController,
  listOwnPrivacyRequestsController,
  privacyExportController
} from './privacy.controller';
import {
  createPrivacyRequestSchema,
  deleteRequestSchema,
  privacyRequestParamsSchema
} from './privacy.schema';

export const privacyRoutes = Router();
export const privacyRequestRoutes = Router();

privacyRequestRoutes.use(authenticateSessionOrUser);
privacyRequestRoutes.post('/', validate({ body: createPrivacyRequestSchema }), createPrivacyRequestController);
privacyRequestRoutes.get('/me', listOwnPrivacyRequestsController);
privacyRequestRoutes.get(
  '/:id',
  validate({ params: privacyRequestParamsSchema }),
  getOwnPrivacyRequestController
);

privacyRoutes.use(authenticateSessionOrUser);
privacyRoutes.get('/export', privacyExportController);
privacyRoutes.post(
  '/delete-request',
  validate({ body: deleteRequestSchema }),
  deletionRequestController
);
