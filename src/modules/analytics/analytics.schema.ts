import { z } from 'zod';

import { ANALYTICS_EXPORT_FORMATS, LOCAL_INTELLIGENCE_TIMEFRAMES } from './analytics.constants';

export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(12).optional()
});

export const analyticsExportQuerySchema = analyticsQuerySchema.extend({
  format: z.enum(ANALYTICS_EXPORT_FORMATS).default('json')
});

export const localIntelligenceQuerySchema = z.object({
  timeframe: z.enum(LOCAL_INTELLIGENCE_TIMEFRAMES).default('90d'),
  jurisdiction: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional()
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsExportQueryInput = z.infer<typeof analyticsExportQuerySchema>;
export type LocalIntelligenceQueryInput = z.infer<typeof localIntelligenceQuerySchema>;
