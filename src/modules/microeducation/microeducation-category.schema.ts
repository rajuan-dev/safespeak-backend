import { z } from 'zod';

import { MICRO_EDUCATION_CATEGORY_STATUSES } from './microeducation.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a valid hex color');

const optionalUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value ? value : undefined));

export const microEducationCategoryParamsSchema = z.object({
  id: objectIdSchema
});

export const microEducationCategoryQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(MICRO_EDUCATION_CATEGORY_STATUSES).optional()
});

export const createMicroEducationCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  backgroundColor: hexColorSchema.default('#01579B'),
  textColor: hexColorSchema.default('#FFFFFF'),
  iconName: z.string().trim().max(80).optional(),
  imageUrl: optionalUrlSchema,
  status: z.enum(MICRO_EDUCATION_CATEGORY_STATUSES).default('draft'),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0)
});

export const updateMicroEducationCategorySchema =
  createMicroEducationCategorySchema.partial();

export type MicroEducationCategoryQueryInput = z.infer<
  typeof microEducationCategoryQuerySchema
>;
export type CreateMicroEducationCategoryInput = z.infer<
  typeof createMicroEducationCategorySchema
>;
export type UpdateMicroEducationCategoryInput = z.infer<
  typeof updateMicroEducationCategorySchema
>;
