import { z } from 'zod';

import {
  ADMIN_DESTINATION_CHANNELS,
  ADMIN_DESTINATION_TYPES,
  ADMIN_SUBMISSION_TEMPLATE_ACK_MODES,
  ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES,
  ADMIN_TAXONOMY_TYPES,
  PRIVACY_REQUEST_STATUSES
} from './admin.constants';
import { ADMIN_ROLES } from '@modules/rbac/rbac.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const optionalClearedStringSchema = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(null)])
    .optional()
    .transform((value) => (value === null || value === '' ? undefined : value));
const optionalClearedEmailSchema = z
  .union([z.string().trim().email().max(320), z.literal(''), z.literal(null)])
  .optional()
  .transform((value) => (value === null || value === '' ? undefined : value));

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
  channel: z.enum(ADMIN_DESTINATION_CHANNELS).optional(),
  jurisdiction: z.string().trim().max(80).optional(),
  isActive: z.coerce.boolean().optional()
});

export const destinationSchema = z.object({
  type: z.enum(ADMIN_DESTINATION_TYPES),
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  channel: z.enum(ADMIN_DESTINATION_CHANNELS),
  jurisdiction: z.string().trim().min(2).max(80),
  languages: z.array(z.string().trim().min(2).max(20)).min(1).default(['en']),
  endpoint: optionalClearedStringSchema(500),
  contactEmail: optionalClearedEmailSchema,
  contactPhone: optionalClearedStringSchema(80),
  minimumRequiredInfo: z.array(z.string().trim().min(1).max(120)).default([]),
  anonymityOptions: z.array(z.string().trim().min(1).max(120)).default([]),
  expectedNextSteps: z.array(z.string().trim().min(1).max(240)).default([]),
  consentRequired: z.boolean().default(true),
  supportsAcknowledgement: z.boolean().default(false),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({})
});

export const updateDestinationSchema = destinationSchema.partial();

const submissionTemplateFieldMappingSchema = z.object({
  source: z.string().trim().min(1).max(120),
  target: z.string().trim().min(1).max(120),
  required: z.boolean().default(false),
  transform: z.string().trim().max(120).optional()
});

export const submissionTemplateQuerySchema = z.object({
  destinationType: z.enum(ADMIN_DESTINATION_TYPES).optional(),
  channel: z.enum(ADMIN_DESTINATION_CHANNELS).optional(),
  jurisdiction: z.string().trim().max(80).optional(),
  isActive: z.coerce.boolean().optional()
});

export const reportDeliveryQuerySchema = z.object({
  status: z.string().trim().max(80).optional(),
  destinationType: z.enum(ADMIN_DESTINATION_TYPES).optional(),
  channel: z.enum(ADMIN_DESTINATION_CHANNELS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const submissionTemplateSchema = z.object({
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  destinationType: z.enum(ADMIN_DESTINATION_TYPES),
  channel: z.enum(ADMIN_DESTINATION_CHANNELS),
  jurisdiction: z.string().trim().min(2).max(80),
  titleTemplate: z.string().trim().min(1).max(500),
  summaryTemplate: z.string().trim().min(1).max(5000),
  fieldMappings: z.array(submissionTemplateFieldMappingSchema).default([]),
  staticPayload: z.record(z.unknown()).default({}),
  acknowledgementMode: z.enum(ADMIN_SUBMISSION_TEMPLATE_ACK_MODES).default('manual'),
  attachmentMode: z.enum(ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES).default('metadata_only'),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({})
});

export const updateSubmissionTemplateSchema = submissionTemplateSchema.partial();

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
export type SubmissionTemplateQueryInput = z.infer<typeof submissionTemplateQuerySchema>;
export type ReportDeliveryQueryInput = z.infer<typeof reportDeliveryQuerySchema>;
export type SubmissionTemplateInput = z.infer<typeof submissionTemplateSchema>;
export type UpdateSubmissionTemplateInput = z.infer<typeof updateSubmissionTemplateSchema>;
export type PrivacyRequestQueryInput = z.infer<typeof privacyRequestQuerySchema>;
export type UpdatePrivacyRequestInput = z.infer<typeof updatePrivacyRequestSchema>;
