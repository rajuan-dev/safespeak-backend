import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminAiEngineOverviewController,
  adminCulturalProfilesController,
  adminCulturalProfilesOverviewController,
  adminDashboardController,
  adminDataProtectionOverviewController,
  adminDestinationsController,
  adminEducationalContentController,
  adminIntelligenceCenterOverviewController,
  adminKnowledgeSourcesController,
  adminLanguagePacksOverviewController,
  adminPrivacyRequestsController,
  adminReportDeliveriesController,
  adminSubmissionTemplatesController,
  adminTaxonomyController,
  adminTaxonomiesController,
  adminUsersController,
  createAdminCulturalProfileController,
  createAdminUserController,
  createAdminDestinationController,
  createAdminSubmissionTemplateController,
  createAdminTaxonomyController,
  deleteAdminCulturalProfileController,
  deleteAdminTaxonomyController,
  updateAdminUserController,
  updateAdminCulturalProfileController,
  updateAdminDestinationController,
  updateAdminPrivacyRequestController,
  updateAdminSubmissionTemplateController,
  updateAdminTaxonomyController
} from './admin.controller';
import {
  adminParamsSchema,
  culturalProfileQuerySchema,
  culturalProfileSchema,
  createAdminUserSchema,
  destinationQuerySchema,
  destinationSchema,
  privacyRequestQuerySchema,
  reportDeliveryQuerySchema,
  submissionTemplateQuerySchema,
  submissionTemplateSchema,
  taxonomyQuerySchema,
  taxonomySchema,
  updateAdminUserSchema,
  updateCulturalProfileSchema,
  updateDestinationSchema,
  updatePrivacyRequestSchema,
  updateSubmissionTemplateSchema,
  updateTaxonomySchema,
  usersQuerySchema
} from './admin.schema';

export const adminRoutes = Router();

adminRoutes.use(authenticateUser, requireAdminRole());

adminRoutes.get('/dashboard', adminDashboardController);
adminRoutes.get('/users', validate({ query: usersQuerySchema }), adminUsersController);
adminRoutes.post(
  '/users',
  requireAdminRole('super_admin'),
  validate({ body: createAdminUserSchema }),
  createAdminUserController
);
adminRoutes.patch(
  '/users/:id',
  requireAdminRole('super_admin'),
  validate({ params: adminParamsSchema, body: updateAdminUserSchema }),
  updateAdminUserController
);
adminRoutes.get('/taxonomies', validate({ query: taxonomyQuerySchema }), adminTaxonomiesController);
adminRoutes.get(
  '/taxonomies/:id',
  validate({ params: adminParamsSchema }),
  adminTaxonomyController
);
adminRoutes.post('/taxonomies', validate({ body: taxonomySchema }), createAdminTaxonomyController);
adminRoutes.patch(
  '/taxonomies/:id',
  validate({ params: adminParamsSchema, body: updateTaxonomySchema }),
  updateAdminTaxonomyController
);
adminRoutes.delete(
  '/taxonomies/:id',
  validate({ params: adminParamsSchema }),
  deleteAdminTaxonomyController
);
adminRoutes.get('/cultural-profiles/overview', adminCulturalProfilesOverviewController);
adminRoutes.get(
  '/cultural-profiles',
  validate({ query: culturalProfileQuerySchema }),
  adminCulturalProfilesController
);
adminRoutes.post(
  '/cultural-profiles',
  validate({ body: culturalProfileSchema }),
  createAdminCulturalProfileController
);
adminRoutes.patch(
  '/cultural-profiles/:id',
  validate({ params: adminParamsSchema, body: updateCulturalProfileSchema }),
  updateAdminCulturalProfileController
);
adminRoutes.delete(
  '/cultural-profiles/:id',
  validate({ params: adminParamsSchema }),
  deleteAdminCulturalProfileController
);
adminRoutes.get(
  '/destinations',
  validate({ query: destinationQuerySchema }),
  adminDestinationsController
);
adminRoutes.post(
  '/destinations',
  validate({ body: destinationSchema }),
  createAdminDestinationController
);
adminRoutes.patch(
  '/destinations/:id',
  validate({ params: adminParamsSchema, body: updateDestinationSchema }),
  updateAdminDestinationController
);
adminRoutes.get(
  '/submission-templates',
  validate({ query: submissionTemplateQuerySchema }),
  adminSubmissionTemplatesController
);
adminRoutes.post(
  '/submission-templates',
  validate({ body: submissionTemplateSchema }),
  createAdminSubmissionTemplateController
);
adminRoutes.patch(
  '/submission-templates/:id',
  validate({ params: adminParamsSchema, body: updateSubmissionTemplateSchema }),
  updateAdminSubmissionTemplateController
);
adminRoutes.get(
  '/report-deliveries',
  validate({ query: reportDeliveryQuerySchema }),
  adminReportDeliveriesController
);
adminRoutes.get('/knowledge-sources', adminKnowledgeSourcesController);
adminRoutes.get('/educational-content', adminEducationalContentController);
adminRoutes.get('/data-protection/overview', adminDataProtectionOverviewController);
adminRoutes.get('/ai-engine/overview', adminAiEngineOverviewController);
adminRoutes.get('/language-packs/overview', adminLanguagePacksOverviewController);
adminRoutes.get('/insights/incident-insights/overview', adminIntelligenceCenterOverviewController);
adminRoutes.get(
  '/privacy-requests',
  validate({ query: privacyRequestQuerySchema }),
  adminPrivacyRequestsController
);
adminRoutes.patch(
  '/privacy-requests/:id',
  validate({ params: adminParamsSchema, body: updatePrivacyRequestSchema }),
  updateAdminPrivacyRequestController
);
