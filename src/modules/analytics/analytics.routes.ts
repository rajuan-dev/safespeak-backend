import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  analyticsCategoriesController,
  analyticsExportController,
  analyticsHeatmapController,
  analyticsLanguagesController,
  analyticsOverviewController,
  analyticsTrendsController,
  publicLocalIntelligenceController
} from './analytics.controller';
import {
  analyticsExportQuerySchema,
  analyticsQuerySchema,
  localIntelligenceQuerySchema
} from './analytics.schema';

export const analyticsRoutes = Router();
export const publicAnalyticsRoutes = Router();

publicAnalyticsRoutes.get(
  '/public/local-intelligence',
  validate({ query: localIntelligenceQuerySchema }),
  publicLocalIntelligenceController
);

analyticsRoutes.use(authenticateUser, requireAdminRole('super_admin', 'analytics_viewer'));

analyticsRoutes.get(
  '/overview',
  validate({ query: analyticsQuerySchema }),
  analyticsOverviewController
);
analyticsRoutes.get(
  '/heatmap',
  validate({ query: analyticsQuerySchema }),
  analyticsHeatmapController
);
analyticsRoutes.get(
  '/trends',
  validate({ query: analyticsQuerySchema }),
  analyticsTrendsController
);
analyticsRoutes.get(
  '/categories',
  validate({ query: analyticsQuerySchema }),
  analyticsCategoriesController
);
analyticsRoutes.get(
  '/languages',
  validate({ query: analyticsQuerySchema }),
  analyticsLanguagesController
);
analyticsRoutes.get(
  '/export',
  validate({ query: analyticsExportQuerySchema }),
  analyticsExportController
);
