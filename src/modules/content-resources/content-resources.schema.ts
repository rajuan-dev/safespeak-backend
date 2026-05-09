import { z } from 'zod';

import { CONTENT_RESOURCE_STATUSES } from './content-resources.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalTrimmedString = (minimumLength = 1, maximumLength = 200) =>
  z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(minimumLength).max(maximumLength).optional()
  );

const reviewDateSchema = z.preprocess(emptyStringToUndefined, z.coerce.date().optional());

export const contentResourceParamsSchema = z.object({
  id: objectIdSchema
});

export const contentResourceQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(CONTENT_RESOURCE_STATUSES).optional()
});

export const createContentResourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  language: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(80),
  jurisdiction: z.string().trim().min(1).max(160),
  reviewDate: reviewDateSchema,
  status: z.enum(CONTENT_RESOURCE_STATUSES).default('published')
});

export const updateContentResourceSchema = z.object({
  name: optionalTrimmedString(1, 200),
  language: optionalTrimmedString(1, 80),
  category: optionalTrimmedString(1, 80),
  jurisdiction: optionalTrimmedString(1, 160),
  reviewDate: reviewDateSchema,
  status: z.enum(CONTENT_RESOURCE_STATUSES).optional()
});

export type ContentResourceParamsInput = z.infer<typeof contentResourceParamsSchema>;
export type ContentResourceQueryInput = z.infer<typeof contentResourceQuerySchema>;
export type CreateContentResourceInput = z.infer<typeof createContentResourceSchema>;
export type UpdateContentResourceInput = z.infer<typeof updateContentResourceSchema>;
