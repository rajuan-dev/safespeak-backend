import { Router } from 'express';

import {
  authenticateSessionOrUser,
  authenticateUser,
  requireAdminRole
} from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  advocateRequestController,
  cancelOwnedAdvocateRequestController,
  createAdminAdvocateProfileController,
  createAdminServiceController,
  createSafetyPlanController,
  deleteAdminServiceController,
  deleteAdminAdvocateProfileController,
  getAdminAdvocateProfileDependenciesController,
  getOwnedAdvocateRequestController,
  getServiceController,
  helpSupportRequestController,
  listAdminServicesController,
  listAdminAdvocateProfilesController,
  listAdminAdvocateRequestsController,
  listAdminWarmReferralsController,
  listAdvocatesController,
  listOwnedAdvocateRequestsController,
  listSafetyPlansController,
  listServicesController,
  recommendationsController,
  updateAdminWarmReferralController,
  updateAdminAdvocateProfileController,
  updateAdminAdvocateRequestController,
  updateAdminServiceController,
  updateSafetyPlanController,
  warmReferralController
} from './support.controller';
import {
  adminServicesQuerySchema,
  adminAdvocateProfileParamsSchema,
  adminAdvocateProfileQuerySchema,
  adminAdvocateRequestParamsSchema,
  adminAdvocateRequestQuerySchema,
  adminWarmReferralQuerySchema,
  adminSupportServiceParamsSchema,
  advocateRequestParamsSchema,
  advocateProfileSchema,
  advocateQuerySchema,
  advocateRequestSchema,
  cancelAdvocateRequestSchema,
  helpSupportRequestSchema,
  recommendationsSchema,
  ownedAdvocateRequestQuerySchema,
  safetyPlanParamsSchema,
  safetyPlanSchema,
  serviceParamsSchema,
  servicesQuerySchema,
  supportServiceSchema,
  updateWarmReferralStatusSchema,
  updateAdvocateProfileSchema,
  updateAdvocateRequestSchema,
  updateSupportServiceSchema,
  updateSafetyPlanSchema,
  warmReferralSchema
} from './support.schema';

export const supportRoutes = Router();
export const adminSupportServiceRoutes = Router();
export const adminAdvocateRoutes = Router();

adminSupportServiceRoutes.use(authenticateUser, requireAdminRole('super_admin', 'integration_admin'));
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

adminAdvocateRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminAdvocateRoutes.get(
  '/profiles',
  validate({ query: adminAdvocateProfileQuerySchema }),
  listAdminAdvocateProfilesController
);
adminAdvocateRoutes.post(
  '/profiles',
  validate({ body: advocateProfileSchema }),
  createAdminAdvocateProfileController
);
adminAdvocateRoutes.patch(
  '/profiles/:id',
  validate({ params: adminAdvocateProfileParamsSchema, body: updateAdvocateProfileSchema }),
  updateAdminAdvocateProfileController
);
adminAdvocateRoutes.get(
  '/profiles/:id/dependencies',
  validate({ params: adminAdvocateProfileParamsSchema }),
  getAdminAdvocateProfileDependenciesController
);
adminAdvocateRoutes.delete(
  '/profiles/:id',
  validate({ params: adminAdvocateProfileParamsSchema }),
  deleteAdminAdvocateProfileController
);
adminAdvocateRoutes.get(
  '/requests',
  validate({ query: adminAdvocateRequestQuerySchema }),
  listAdminAdvocateRequestsController
);
adminAdvocateRoutes.patch(
  '/requests/:id',
  validate({ params: adminAdvocateRequestParamsSchema, body: updateAdvocateRequestSchema }),
  updateAdminAdvocateRequestController
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
supportRoutes.get('/advocates', validate({ query: advocateQuerySchema }), listAdvocatesController);
supportRoutes.get(
  '/advocate-requests/me',
  validate({ query: ownedAdvocateRequestQuerySchema }),
  listOwnedAdvocateRequestsController
);
supportRoutes.get(
  '/advocate-requests/:id',
  validate({ params: advocateRequestParamsSchema }),
  getOwnedAdvocateRequestController
);
supportRoutes.patch(
  '/advocate-requests/:id/cancel',
  validate({ params: advocateRequestParamsSchema, body: cancelAdvocateRequestSchema }),
  cancelOwnedAdvocateRequestController
);
supportRoutes.post(
  '/advocate-request',
  validate({ body: advocateRequestSchema }),
  advocateRequestController
);
supportRoutes.post(
  '/help-request',
  validate({ body: helpSupportRequestSchema }),
  helpSupportRequestController
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
