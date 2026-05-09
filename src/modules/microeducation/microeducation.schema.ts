import { z } from 'zod';

import {
  MICRO_EDUCATION_CHIPS,
  MICRO_EDUCATION_DURATIONS,
  MICRO_EDUCATION_FORMATS,
  MICRO_EDUCATION_STATUSES,
  MICRO_EDUCATION_TONES
} from './microeducation.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const microEducationParamsSchema = z.object({
  id: objectIdSchema
});

export const microEducationAdminQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(MICRO_EDUCATION_STATUSES).optional()
});

export const createMicroEducationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(900),
  tag: z.string().trim().min(1).max(80).default('Safety'),
  cta: z.string().trim().min(1).max(80).default('Start Now'),
  tone: z.enum(MICRO_EDUCATION_TONES).default('blue'),
  chips: z.array(z.enum(MICRO_EDUCATION_CHIPS)).min(1).max(4).default(['safety']),
  duration: z.enum(MICRO_EDUCATION_DURATIONS).default('quick'),
  format: z.enum(MICRO_EDUCATION_FORMATS).default('guide'),
  status: z.enum(MICRO_EDUCATION_STATUSES).default('draft'),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  views: z.coerce.number().int().min(0).max(100000000).default(0)
});

export const updateMicroEducationSchema = createMicroEducationSchema.partial();

export type MicroEducationAdminQueryInput = z.infer<typeof microEducationAdminQuerySchema>;
export type CreateMicroEducationInput = z.infer<typeof createMicroEducationSchema>;
export type UpdateMicroEducationInput = z.infer<typeof updateMicroEducationSchema>;
