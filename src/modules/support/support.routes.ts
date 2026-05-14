import { Router } from 'express';

import {
  authenticateSessionOrUser,
  authenticateUser,
  requireAdminRole
} from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  advocateRequestController,
  createAdminServiceController,
  createSafetyPlanController,
  deleteAdminServiceController,
  getServiceController,
  listAdminServicesController,
  listAdminWarmReferralsController,
  listAdvocatesController,
  listSafetyPlansController,
  listServicesController,
  recommendationsController,
  updateAdminWarmReferralController,
  updateAdminServiceController,
  updateSafetyPlanController,
  warmReferralController
} from './support.controller';
import {
  adminServicesQuerySchema,
  adminWarmReferralQuerySchema,
  adminSupportServiceParamsSchema,
  advocateRequestSchema,
  recommendationsSchema,
  safetyPlanParamsSchema,
  safetyPlanSchema,
  serviceParamsSchema,
  servicesQuerySchema,
  supportServiceSchema,
  updateWarmReferralStatusSchema,
  updateSupportServiceSchema,
  updateSafetyPlanSchema,
  warmReferralSchema
} from './support.schema';

export const supportRoutes = Router();
export const adminSupportServiceRoutes = Router();

adminSupportServiceRoutes.use(authenticateUser, requireAdminRole());
adminSupportServiceRoutes.get(
  '/',
  validate({ query: adminServicesQuerySchema }),
  listAdminServicesController
);
adminSupportServiceRoutes.post(
  '/',
  validate({ body: supportServiceSchema }),
  createAdminServiceController
);
adminSupportServiceRoutes.patch(
  '/:id',
  validate({ params: adminSupportServiceParamsSchema, body: updateSupportServiceSchema }),
  updateAdminServiceController
);
adminSupportServiceRoutes.delete(
  '/:id',
  validate({ params: adminSupportServiceParamsSchema }),
  deleteAdminServiceController
);
adminSupportServiceRoutes.get(
  '/warm-referrals',
  validate({ query: adminWarmReferralQuerySchema }),
  listAdminWarmReferralsController
);
adminSupportServiceRoutes.patch(
  '/warm-referrals/:id',
  validate({ params: safetyPlanParamsSchema, body: updateWarmReferralStatusSchema }),
  updateAdminWarmReferralController
);

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
