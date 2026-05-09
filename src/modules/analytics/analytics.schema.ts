import { z } from 'zod';

import { ANALYTICS_EXPORT_FORMATS } from './analytics.constants';

export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(12).optional()
});

export const analyticsExportQuerySchema = analyticsQuerySchema.extend({
  format: z.enum(ANALYTICS_EXPORT_FORMATS).default('json')
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsExportQueryInput = z.infer<typeof analyticsExportQuerySchema>;
