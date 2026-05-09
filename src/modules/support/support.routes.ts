import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  advocateRequestController,
  createSafetyPlanController,
  getServiceController,
  listAdvocatesController,
  listSafetyPlansController,
  listServicesController,
  recommendationsController,
  updateSafetyPlanController,
  warmReferralController
} from './support.controller';
import {
  advocateRequestSchema,
  recommendationsSchema,
  safetyPlanParamsSchema,
  safetyPlanSchema,
  serviceParamsSchema,
  servicesQuerySchema,
  updateSafetyPlanSchema,
  warmReferralSchema
} from './support.schema';

export const supportRoutes = Router();

supportRoutes.use(authenticateSessionOrUser);

supportRoutes.get('/services', validate({ query: servicesQuerySchema }), listServicesController);
supportRoutes.get('/services/:id', validate({ params: serviceParamsSchema }), getServiceController);
supportRoutes.post(
  '/recommendations',
  validate({ body: recommendationsSchema }),
  recommendationsController
);
supportRoutes.post(
  '/warm-referral',
  validate({ body: warmReferralSchema }),
  warmReferralController
);
supportRoutes.get('/advocates', listAdvocatesController);
supportRoutes.post(
  '/advocate-request',
  validate({ body: advocateRequestSchema }),
  advocateRequestController
);
supportRoutes.get('/safety-plans', listSafetyPlansController);
supportRoutes.post(
  '/safety-plans',
  validate({ body: safetyPlanSchema }),
  createSafetyPlanController
);
supportRoutes.patch(
  '/safety-plans/:id',
  validate({ params: safetyPlanParamsSchema, body: updateSafetyPlanSchema }),
  updateSafetyPlanController
);
