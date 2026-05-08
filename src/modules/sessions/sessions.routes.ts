import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  convertToUserController,
  createAnonymousSessionController,
  getCurrentSessionController
} from './sessions.controller';
import { convertToUserSchema, createAnonymousSessionSchema } from './sessions.schema';

export const sessionsRoutes = Router();

sessionsRoutes.post(
  '/anonymous',
  validate({ body: createAnonymousSessionSchema }),
  createAnonymousSessionController
);
sessionsRoutes.get('/current', authenticateSessionOrUser, getCurrentSessionController);
sessionsRoutes.post(
  '/convert-to-user',
  authenticateSessionOrUser,
  validate({ body: convertToUserSchema }),
  convertToUserController
);
