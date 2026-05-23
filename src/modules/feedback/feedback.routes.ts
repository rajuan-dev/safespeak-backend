import { Router } from 'express';

import {
  authenticateSessionOrUser,
  authenticateUser,
  requireAdminRole
} from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  createFeedbackController,
  listAdminFeedbackController,
  updateAdminFeedbackController
} from './feedback.controller';
import {
  adminFeedbackQuerySchema,
  feedbackParamsSchema,
  feedbackSubmissionSchema,
  updateAdminFeedbackSchema
} from './feedback.schema';

export const feedbackRoutes = Router();
export const adminFeedbackRoutes = Router();

feedbackRoutes.use(authenticateSessionOrUser);
feedbackRoutes.post('/', validate({ body: feedbackSubmissionSchema }), createFeedbackController);

adminFeedbackRoutes.use(authenticateUser, requireAdminRole('super_admin'));
adminFeedbackRoutes.get('/', validate({ query: adminFeedbackQuerySchema }), listAdminFeedbackController);
adminFeedbackRoutes.patch(
  '/:id',
  validate({ params: feedbackParamsSchema, body: updateAdminFeedbackSchema }),
  updateAdminFeedbackController
);
