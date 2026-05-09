import { z } from 'zod';

import { RESOURCE_STATUSES } from './resources.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const resourceParamsSchema = z.object({
  id: objectIdSchema
});

export const resourceAdminQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(RESOURCE_STATUSES).optional()
});

export const createResourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(160),
  contact: z.string().trim().min(1).max(320),
  status: z.enum(RESOURCE_STATUSES).default('published'),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0)
});

export const updateResourceSchema = createResourceSchema.partial();

export type ResourceAdminQueryInput = z.infer<typeof resourceAdminQuerySchema>;
export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
