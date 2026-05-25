import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminAuditLogsController,
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
  adminNotificationsController,
  adminPlatformHealthOverviewController,
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
  markAdminNotificationReadController,
  markAdminNotificationsReadController,
  updateAdminUserController,
  updateAdminCulturalProfileController,
  updateAdminDestinationController,
  updateAdminPrivacyRequestController,
  updateAdminSubmissionTemplateController,
  updateAdminTaxonomyController
} from './admin.controller';
import {
  adminParamsSchema,
  adminNotificationsQuerySchema,
  auditLogsQuerySchema,
  culturalProfileQuerySchema,
  culturalProfileSchema,
  createAdminUserSchema,
  destinationQuerySchema,
  destinationSchema,
  markAdminNotificationReadSchema,
  markAdminNotificationsReadSchema,
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
adminRoutes.get(
  '/audit-logs',
  requireAdminRole('super_admin'),
  validate({ query: auditLogsQuerySchema }),
  adminAuditLogsController
);
adminRoutes.get(
  '/notifications',
  requireAdminRole('super_admin'),
  validate({ query: adminNotificationsQuerySchema }),
  adminNotificationsController
);
adminRoutes.post(
  '/notifications/read',
  requireAdminRole('super_admin'),
  validate({ body: markAdminNotificationReadSchema }),
  markAdminNotificationReadController
);
adminRoutes.post(
  '/notifications/read-all',
  requireAdminRole('super_admin'),
  validate({ body: markAdminNotificationsReadSchema }),
  markAdminNotificationsReadController
);
adminRoutes.get(
  '/users',
  requireAdminRole('super_admin'),
  validate({ query: usersQuerySchema }),
  adminUsersController
);
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
adminRoutes.get(
  '/taxonomies',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ query: taxonomyQuerySchema }),
  adminTaxonomiesController
);
adminRoutes.get(
  '/taxonomies/:id',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ params: adminParamsSchema }),
  adminTaxonomyController
);
adminRoutes.post(
  '/taxonomies',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ body: taxonomySchema }),
  createAdminTaxonomyController
);
adminRoutes.patch(
  '/taxonomies/:id',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ params: adminParamsSchema, body: updateTaxonomySchema }),
  updateAdminTaxonomyController
);
adminRoutes.delete(
  '/taxonomies/:id',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ params: adminParamsSchema }),
  deleteAdminTaxonomyController
);
adminRoutes.get('/cultural-profiles/overview', adminCulturalProfilesOverviewController);
adminRoutes.get(
  '/cultural-profiles',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ query: culturalProfileQuerySchema }),
  adminCulturalProfilesController
);
adminRoutes.post(
  '/cultural-profiles',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ body: culturalProfileSchema }),
  createAdminCulturalProfileController
);
adminRoutes.patch(
  '/cultural-profiles/:id',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ params: adminParamsSchema, body: updateCulturalProfileSchema }),
  updateAdminCulturalProfileController
);
adminRoutes.delete(
  '/cultural-profiles/:id',
  requireAdminRole('super_admin', 'content_admin'),
  validate({ params: adminParamsSchema }),
  deleteAdminCulturalProfileController
);
adminRoutes.get(
  '/destinations',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ query: destinationQuerySchema }),
  adminDestinationsController
);
adminRoutes.post(
  '/destinations',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ body: destinationSchema }),
  createAdminDestinationController
);
adminRoutes.patch(
  '/destinations/:id',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ params: adminParamsSchema, body: updateDestinationSchema }),
  updateAdminDestinationController
);
adminRoutes.get(
  '/submission-templates',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ query: submissionTemplateQuerySchema }),
  adminSubmissionTemplatesController
);
adminRoutes.post(
  '/submission-templates',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ body: submissionTemplateSchema }),
  createAdminSubmissionTemplateController
);
adminRoutes.patch(
  '/submission-templates/:id',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ params: adminParamsSchema, body: updateSubmissionTemplateSchema }),
  updateAdminSubmissionTemplateController
);
adminRoutes.get(
  '/report-deliveries',
  requireAdminRole('super_admin', 'integration_admin'),
  validate({ query: reportDeliveryQuerySchema }),
  adminReportDeliveriesController
);
adminRoutes.get(
  '/knowledge-sources',
  requireAdminRole('super_admin', 'content_admin'),
  adminKnowledgeSourcesController
);
adminRoutes.get(
  '/educational-content',
  requireAdminRole('super_admin', 'content_admin'),
  adminEducationalContentController
);
adminRoutes.get(
  '/data-protection/overview',
  requireAdminRole('super_admin'),
  adminDataProtectionOverviewController
);
adminRoutes.get(
  '/ai-engine/overview',
  requireAdminRole('super_admin', 'content_admin'),
  adminAiEngineOverviewController
);
adminRoutes.get(
  '/language-packs/overview',
  requireAdminRole('super_admin', 'content_admin'),
  adminLanguagePacksOverviewController
);
adminRoutes.get(
  '/insights/incident-insights/overview',
  requireAdminRole('super_admin', 'analytics_viewer'),
  adminIntelligenceCenterOverviewController
);
adminRoutes.get(
  '/platform-health',
  requireAdminRole('super_admin', 'analytics_viewer'),
  adminPlatformHealthOverviewController
);
adminRoutes.get(
  '/privacy-requests',
  requireAdminRole('super_admin'),
  validate({ query: privacyRequestQuerySchema }),
  adminPrivacyRequestsController
);
adminRoutes.patch(
  '/privacy-requests/:id',
  requireAdminRole('super_admin'),
  validate({ params: adminParamsSchema, body: updatePrivacyRequestSchema }),
  updateAdminPrivacyRequestController
);
