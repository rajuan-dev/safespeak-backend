import { z } from 'zod';

import { SUPPORT_SERVICE_TYPES } from './support.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const serviceParamsSchema = z.object({
  id: z.string().trim().min(1).max(120)
});

export const safetyPlanParamsSchema = z.object({
  id: objectIdSchema
});

export const servicesQuerySchema = z.object({
  type: z.enum(SUPPORT_SERVICE_TYPES).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(12).optional()
});

export const recommendationsSchema = z.object({
  reportId: objectIdSchema.optional(),
  needs: z.array(z.enum(SUPPORT_SERVICE_TYPES)).default([]),
  jurisdiction: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(12).default('en')
});

export const warmReferralSchema = z.object({
  serviceId: z.string().trim().min(1).max(120),
  contactPreference: z.enum(['phone', 'email', 'in_app']),
  safeContact: z.string().trim().min(1).max(320),
  notes: z.string().trim().max(4000).optional()
});

export const advocateRequestSchema = z.object({
  advocateType: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(12).default('en'),
  notes: z.string().trim().max(4000).optional()
});

export const safetyPlanSchema = z.object({
  title: z.string().trim().min(1).max(160),
  trustedContacts: z.array(z.record(z.unknown())).default([]),
  safePlaces: z.array(z.string().trim().min(1).max(300)).default([]),
  warningSigns: z.array(z.string().trim().min(1).max(300)).default([]),
  copingStrategies: z.array(z.string().trim().min(1).max(300)).default([]),
  emergencySteps: z.array(z.string().trim().min(1).max(300)).default([]),
  isActive: z.boolean().default(true)
});

export const updateSafetyPlanSchema = safetyPlanSchema.partial();

export type ServicesQueryInput = z.infer<typeof servicesQuerySchema>;
export type RecommendationsInput = z.infer<typeof recommendationsSchema>;
export type WarmReferralInput = z.infer<typeof warmReferralSchema>;
export type AdvocateRequestInput = z.infer<typeof advocateRequestSchema>;
export type SafetyPlanInput = z.infer<typeof safetyPlanSchema>;
export type UpdateSafetyPlanInput = z.infer<typeof updateSafetyPlanSchema>;
