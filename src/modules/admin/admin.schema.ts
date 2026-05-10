import { z } from 'zod';

import {
  ADMIN_DESTINATION_TYPES,
  ADMIN_TAXONOMY_TYPES,
  PRIVACY_REQUEST_STATUSES
} from './admin.constants';
import { ADMIN_ROLES } from '@modules/rbac/rbac.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const adminParamsSchema = z.object({
  id: objectIdSchema
});

export const usersQuerySchema = z.object({
  role: z.string().trim().max(80).optional(),
  status: z.string().trim().max(80).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const createAdminUserSchema = z.object({
  email: z.string().trim().email().max(320),
  fullName: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(12).max(200),
  role: z.enum(ADMIN_ROLES).default('admin')
});

export const updateAdminUserSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  role: z.enum(ADMIN_ROLES).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'deleted']).optional()
});

export const taxonomyQuerySchema = z.object({
  type: z.enum(ADMIN_TAXONOMY_TYPES).optional(),
  isActive: z.coerce.boolean().optional()
});

export const taxonomySchema = z.object({
  type: z.enum(ADMIN_TAXONOMY_TYPES),
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({})
});

export const updateTaxonomySchema = taxonomySchema.partial();

export const destinationQuerySchema = z.object({
  type: z.enum(ADMIN_DESTINATION_TYPES).optional(),
  isActive: z.coerce.boolean().optional()
});

export const destinationSchema = z.object({
  type: z.enum(ADMIN_DESTINATION_TYPES),
  name: z.string().trim().min(1).max(200),
  endpoint: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({})
});

export const updateDestinationSchema = destinationSchema.partial();

export const privacyRequestQuerySchema = z.object({
  status: z.enum(PRIVACY_REQUEST_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const updatePrivacyRequestSchema = z.object({
  status: z.enum(PRIVACY_REQUEST_STATUSES),
  notes: z.string().trim().max(2000).optional()
});

export type UsersQueryInput = z.infer<typeof usersQuerySchema>;
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;
export type TaxonomyQueryInput = z.infer<typeof taxonomyQuerySchema>;
export type TaxonomyInput = z.infer<typeof taxonomySchema>;
export type UpdateTaxonomyInput = z.infer<typeof updateTaxonomySchema>;
export type DestinationQueryInput = z.infer<typeof destinationQuerySchema>;
export type DestinationInput = z.infer<typeof destinationSchema>;
export type UpdateDestinationInput = z.infer<typeof updateDestinationSchema>;
export type PrivacyRequestQueryInput = z.infer<typeof privacyRequestQuerySchema>;
export type UpdatePrivacyRequestInput = z.infer<typeof updatePrivacyRequestSchema>;
