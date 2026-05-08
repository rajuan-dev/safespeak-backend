import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  getConsentHistoryController,
  getCurrentConsentController,
  updateConsentController,
  withdrawConsentController
} from './consent.controller';
import { updateConsentSchema, withdrawConsentSchema } from './consent.schema';

export const consentRoutes = Router();

consentRoutes.use(authenticateSessionOrUser);
consentRoutes.get('/current', getCurrentConsentController);
consentRoutes.post('/update', validate({ body: updateConsentSchema }), updateConsentController);
consentRoutes.post(
  '/withdraw',
  validate({ body: withdrawConsentSchema }),
  withdrawConsentController
);
consentRoutes.get('/history', getConsentHistoryController);
