import { z } from 'zod';

export const createAnonymousSessionSchema = z.object({
  language: z.string().min(2).max(12).default('en').optional(),
  jurisdiction: z.string().min(2).max(80).default('NSW').optional(),
  lga: z.string().max(120).optional(),
  safetyGateAccepted: z.boolean().default(false).optional()
});

export const convertToUserSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i)
});

export type CreateAnonymousSessionInput = z.infer<typeof createAnonymousSessionSchema>;
