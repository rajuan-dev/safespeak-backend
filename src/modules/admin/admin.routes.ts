import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminDashboardController,
  adminDestinationsController,
  adminEducationalContentController,
  adminKnowledgeSourcesController,
  adminPrivacyRequestsController,
  adminReportDeliveriesController,
  adminSubmissionTemplatesController,
  adminTaxonomyController,
  adminTaxonomiesController,
  adminUsersController,
  createAdminUserController,
  createAdminDestinationController,
  createAdminSubmissionTemplateController,
  createAdminTaxonomyController,
  deleteAdminTaxonomyController,
  updateAdminUserController,
  updateAdminDestinationController,
  updateAdminPrivacyRequestController,
  updateAdminSubmissionTemplateController,
  updateAdminTaxonomyController
} from './admin.controller';
import {
  adminParamsSchema,
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
