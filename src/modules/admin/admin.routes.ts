import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminDashboardController,
  adminDestinationsController,
  adminKnowledgeSourcesController,
  adminPrivacyRequestsController,
  adminTaxonomiesController,
  adminUsersController,
  createAdminUserController,
  createAdminDestinationController,
  createAdminTaxonomyController,
  updateAdminDestinationController,
  updateAdminPrivacyRequestController,
  updateAdminTaxonomyController
} from './admin.controller';
import {
  adminParamsSchema,
  createAdminUserSchema,
  destinationQuerySchema,
  destinationSchema,
  privacyRequestQuerySchema,
  taxonomyQuerySchema,
  taxonomySchema,
  updateDestinationSchema,
  updatePrivacyRequestSchema,
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
adminRoutes.get('/taxonomies', validate({ query: taxonomyQuerySchema }), adminTaxonomiesController);
adminRoutes.post('/taxonomies', validate({ body: taxonomySchema }), createAdminTaxonomyController);
adminRoutes.patch(
  '/taxonomies/:id',
  validate({ params: adminParamsSchema, body: updateTaxonomySchema }),
  updateAdminTaxonomyController
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
adminRoutes.get('/knowledge-sources', adminKnowledgeSourcesController);
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
