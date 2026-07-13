import { z } from 'zod';

import {
  ADVOCATE_AVAILABILITIES,
  ADVOCATE_OPT_IN_STATUSES,
  ADVOCATE_REQUEST_STATUSES,
  ADVOCATE_VETTING_STATUSES,
  SUPPORT_ISSUE_TYPES,
  SUPPORT_RESOURCE_RISK_LEVELS,
  SUPPORT_RESOURCE_TYPES,
  SUPPORT_REQUEST_STATUSES,
  SUPPORT_SERVICE_CARD_ICONS,
  SUPPORT_SERVICE_OVERLAY_TONES,
  SUPPORT_SERVICE_TYPES
} from './support.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const optionalUrlSchema = z.string().trim().url().max(500).optional().or(z.literal(''));
const stringListSchema = z.array(z.string().trim().min(1).max(160)).default([]);
const keySchema = z.string().trim().toLowerCase().min(2).max(120).regex(/^[a-z][a-z0-9_]*$/);
const languageIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(12)
  .regex(/^[a-z]{2,3}(?:-[a-z]{2})?$/, 'Use a canonical language id such as en or en-us');

export const serviceParamsSchema = z.object({
  id: z.string().trim().min(1).max(120)
});

export const safetyPlanParamsSchema = z.object({
  id: objectIdSchema
});

export const adminSupportServiceParamsSchema = z.object({
  id: objectIdSchema
});

export const adminAdvocateProfileParamsSchema = z.object({
  id: objectIdSchema
});

export const adminAdvocateRequestParamsSchema = z.object({
  id: objectIdSchema
});

export const advocateRequestParamsSchema = z.object({
  id: objectIdSchema
});

export const servicesQuerySchema = z.object({
  type: z.enum(SUPPORT_SERVICE_TYPES).optional(),
  resourceType: z.enum(SUPPORT_RESOURCE_TYPES).optional(),
  issueType: z.enum(SUPPORT_ISSUE_TYPES).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(12).optional(),
  region: z.string().trim().max(120).optional(),
  eligibility: z.string().trim().max(160).optional(),
  profile: z.string().trim().max(160).optional()
});

export const adminServicesQuerySchema = servicesQuerySchema.extend({
  isPublished: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional()
});

export const adminWarmReferralQuerySchema = z.object({
  status: z.enum(SUPPORT_REQUEST_STATUSES).optional(),
  serviceId: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const advocateQuerySchema = z.object({
  language: languageIdSchema.optional(),
  region: z.string().trim().max(120).optional(),
  issueType: z.enum(SUPPORT_ISSUE_TYPES).optional(),
  culturalProfile: z.string().trim().max(160).optional(),
  faithProfile: z.string().trim().max(160).optional(),
  availability: z.enum(ADVOCATE_AVAILABILITIES).optional()
});

export const adminAdvocateProfileQuerySchema = advocateQuerySchema.extend({
  isPublished: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  vettingStatus: z.enum(ADVOCATE_VETTING_STATUSES).optional(),
  optInStatus: z.enum(ADVOCATE_OPT_IN_STATUSES).optional(),
  includeDeleted: z.coerce.boolean().optional()
});

export const adminAdvocateRequestQuerySchema = z.object({
  status: z.enum(ADVOCATE_REQUEST_STATUSES).optional(),
  advocateProfileId: objectIdSchema.optional(),
  advocateKey: z.string().trim().toLowerCase().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const ownedAdvocateRequestQuerySchema = z.object({
  status: z.enum(ADVOCATE_REQUEST_STATUSES).optional(),
  activeOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const updateWarmReferralStatusSchema = z.object({
  status: z.enum(SUPPORT_REQUEST_STATUSES),
  notes: z.string().trim().max(1000).optional()
});

export const supportServiceSchema = z.object({
  key: z.string().trim().toLowerCase().min(2).max(120).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(200),
  type: z.enum(SUPPORT_SERVICE_TYPES),
  description: z.string().trim().min(1).max(4000),
  cardImageUrl: optionalUrlSchema,
  cardImageAlt: z.string().trim().max(180).optional().or(z.literal('')),
  cardIcon: z.enum(SUPPORT_SERVICE_CARD_ICONS).default('shield'),
  cardOverlayTone: z.enum(SUPPORT_SERVICE_OVERLAY_TONES).default('default'),
  availabilityLabel: z.string().trim().min(1).max(80).default('Available Now'),
  referralTitle: z.string().trim().min(1).max(120).default('Warm Referral'),
  referralDescription: z
    .string()
    .trim()
    .min(1)
    .max(1200)
    .default(
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.'
    ),
  resourceType: z.enum(SUPPORT_RESOURCE_TYPES).default('government'),
  issueTypes: z.array(z.enum(SUPPORT_ISSUE_TYPES)).default(['general_support']),
  safetyRiskLevels: z.array(z.enum(SUPPORT_RESOURCE_RISK_LEVELS)).default(['all']),
  ctaLabel: z.string().trim().min(1).max(120).default('View options'),
  resourceLinks: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        url: z.string().trim().url().max(500)
      })
    )
    .max(8)
    .default([]),
  jurisdiction: z.string().trim().min(1).max(120),
  regions: stringListSchema,
  languages: z.array(z.string().trim().min(2).max(12)).default(['en']),
  eligibility: stringListSchema,
  bookingUrl: optionalUrlSchema,
  websiteUrl: optionalUrlSchema,
  phone: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(320).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional(),
  crisis: z.boolean().default(false),
  informationOnly: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(50),
  safetyNotes: z.string().trim().max(1200).optional(),
  eligibilityNotes: z.string().trim().max(1200).optional(),
  languageSupportNotes: z.string().trim().max(1200).optional(),
  isPublished: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).default({})
});

export const updateSupportServiceSchema = supportServiceSchema.partial();

export const recommendationsSchema = z.object({
  reportId: objectIdSchema.optional(),
  needs: z.array(z.enum(SUPPORT_SERVICE_TYPES)).default([]),
  resourceTypes: z.array(z.enum(SUPPORT_RESOURCE_TYPES)).default([]),
  issueType: z.enum(SUPPORT_ISSUE_TYPES).optional(),
  safetyRiskLevel: z.enum(SUPPORT_RESOURCE_RISK_LEVELS).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  eligibility: z.string().trim().max(160).optional(),
  profile: z.string().trim().max(160).optional(),
  language: z.string().trim().min(2).max(12).default('en')
});

export const warmReferralSchema = z.object({
  serviceId: z.string().trim().min(1).max(120),
  contactPreference: z.enum(['phone', 'email', 'in_app']),
  safeContact: z.string().trim().min(1).max(320),
  notes: z.string().trim().max(4000).optional(),
  minimalSummary: z
    .object({
      incidentSummary: z.string().trim().max(1000).optional(),
      immediateSafetyConcerns: z.string().trim().max(600).optional(),
      preferredContactMethod: z.string().trim().max(120).optional(),
      interpreterPreference: z.string().trim().max(120).optional(),
      culturalContext: z.string().trim().max(600).optional(),
      informationOnlyDisclaimer: z.boolean().default(true)
    })
    .optional(),
  includedFields: z.array(z.string().trim().min(1).max(120)).default([]),
  shareProfileContext: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({})
});

export const advocateRequestSchema = z.object({
  advocateType: z.string().trim().min(1).max(120),
  advocateProfileId: objectIdSchema.optional(),
  advocateKey: z.string().trim().toLowerCase().max(120).optional(),
  language: languageIdSchema.default('en'),
  issueType: z.enum(SUPPORT_ISSUE_TYPES).optional(),
  region: z.string().trim().max(120).optional(),
  safeContactPreference: z
    .enum(['phone', 'email', 'in_app', 'no_direct_contact'])
    .default('in_app'),
  notes: z.string().trim().max(4000).optional(),
  confirmationCopy: z.string().trim().max(1000).optional()
});

export const advocateTrainingCredentialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).optional().or(z.literal('')),
  completedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  verificationSummary: z.string().trim().max(1000).optional().or(z.literal(''))
});

export const advocateProfileSchema = z.object({
  key: keySchema,
  displayName: z.string().trim().min(1).max(200),
  publicBio: z.string().trim().max(2000).optional().or(z.literal('')),
  languages: z.array(languageIdSchema).min(1).default(['en']),
  regions: stringListSchema.default(['national']),
  issueTypes: z.array(z.enum(SUPPORT_ISSUE_TYPES)).min(1).default(['general_support']),
  culturalProfiles: stringListSchema,
  faithProfiles: stringListSchema,
  availability: z.enum(ADVOCATE_AVAILABILITIES).default('request_based'),
  isActive: z.boolean().default(true),
  isPublished: z.boolean().default(false),
  optInStatus: z.enum(ADVOCATE_OPT_IN_STATUSES).default('pending'),
  vetting: z
    .object({
      status: z.enum(ADVOCATE_VETTING_STATUSES).default('pending'),
      reviewedAt: z.coerce.date().optional(),
      notes: z.string().trim().max(2000).optional().or(z.literal(''))
    })
    .default({ status: 'pending' }),
  trainingCredentials: z.array(advocateTrainingCredentialSchema).max(24).default([]),
  internalContactReference: z.string().trim().max(300).optional().or(z.literal('')),
  privateEmail: z.string().trim().email().max(320).optional().or(z.literal('')),
  privatePhone: z.string().trim().max(80).optional().or(z.literal(''))
});

export const updateAdvocateProfileSchema = advocateProfileSchema.partial();

export const updateAdvocateRequestSchema = z.object({
  status: z.enum(ADVOCATE_REQUEST_STATUSES).optional(),
  assignedAdvocateProfileId: objectIdSchema.optional(),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
  noteAction: z
    .enum(['assign', 'reassign', 'contact_initiated', 'decline', 'close'])
    .optional(),
  reasonCode: z.string().trim().max(80).optional().or(z.literal(''))
});

export const cancelAdvocateRequestSchema = z.object({
  reasonCode: z.string().trim().max(80).default('user_cancelled')
});

export const helpSupportRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000)
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
export type AdminServicesQueryInput = z.infer<typeof adminServicesQuerySchema>;
export type AdminWarmReferralQueryInput = z.infer<typeof adminWarmReferralQuerySchema>;
export type AdvocateQueryInput = z.infer<typeof advocateQuerySchema>;
export type AdminAdvocateProfileQueryInput = z.infer<typeof adminAdvocateProfileQuerySchema>;
export type AdminAdvocateRequestQueryInput = z.infer<typeof adminAdvocateRequestQuerySchema>;
export type OwnedAdvocateRequestQueryInput = z.infer<typeof ownedAdvocateRequestQuerySchema>;
export type UpdateWarmReferralStatusInput = z.infer<typeof updateWarmReferralStatusSchema>;
export type SupportServiceInput = z.infer<typeof supportServiceSchema>;
export type UpdateSupportServiceInput = z.infer<typeof updateSupportServiceSchema>;
export type RecommendationsInput = z.infer<typeof recommendationsSchema>;
export type WarmReferralInput = z.infer<typeof warmReferralSchema>;
export type AdvocateRequestInput = z.infer<typeof advocateRequestSchema>;
export type AdvocateProfileInput = z.infer<typeof advocateProfileSchema>;
export type UpdateAdvocateProfileInput = z.infer<typeof updateAdvocateProfileSchema>;
export type UpdateAdvocateRequestInput = z.infer<typeof updateAdvocateRequestSchema>;
export type CancelAdvocateRequestInput = z.infer<typeof cancelAdvocateRequestSchema>;
export type HelpSupportRequestInput = z.infer<typeof helpSupportRequestSchema>;
export type SafetyPlanInput = z.infer<typeof safetyPlanSchema>;
export type UpdateSafetyPlanInput = z.infer<typeof updateSafetyPlanSchema>;
