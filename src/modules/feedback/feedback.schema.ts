import { z } from 'zod';

import { FEEDBACK_SOURCES, FEEDBACK_STATUSES } from './feedback.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const optionalClearedStringSchema = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.literal(null)])
    .optional()
    .transform((value) => (value === null || value === '' ? undefined : value));
const optionalClearedEmailSchema = z
  .union([z.string().trim().email().max(320), z.literal(''), z.literal(null)])
  .optional()
  .transform((value) => (value === null || value === '' ? undefined : value));

export const feedbackParamsSchema = z.object({
  id: objectIdSchema
});

export const feedbackSubmissionSchema = z.object({
  name: optionalClearedStringSchema(200),
  email: optionalClearedEmailSchema,
  phone: optionalClearedStringSchema(80),
  subject: optionalClearedStringSchema(200),
  message: z.string().trim().min(1).max(4000),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  source: z.enum(FEEDBACK_SOURCES).default('user_feedback'),
  metadata: z.record(z.unknown()).default({})
});

export const adminFeedbackQuerySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  source: z.enum(FEEDBACK_SOURCES).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const updateAdminFeedbackSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).optional(),
    adminNotes: optionalClearedStringSchema(2000)
  })
  .refine((value) => value.status !== undefined || value.adminNotes !== undefined, {
    message: 'At least one feedback field must be provided'
  });

export type FeedbackSubmissionInput = z.infer<typeof feedbackSubmissionSchema>;
export type AdminFeedbackQueryInput = z.infer<typeof adminFeedbackQuerySchema>;
export type UpdateAdminFeedbackInput = z.infer<typeof updateAdminFeedbackSchema>;
