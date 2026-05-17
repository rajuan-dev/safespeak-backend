import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const privacyRequestTypes = ['data_export', 'data_deletion', 'account_deactivation'] as const;

export const privacyRequestParamsSchema = z.object({
  id: objectIdSchema
});

export const createPrivacyRequestSchema = z.object({
  requestType: z.enum(privacyRequestTypes),
  notes: z.string().trim().max(2000).optional(),
  confirmation: z.boolean().default(false)
});

export const deleteRequestSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
  confirmation: z.boolean().default(false)
});

export const deactivateAccountSchema = z.object({
  confirmation: z.literal('DEACTIVATE')
});

export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestSchema>;
export type DeleteRequestInput = z.infer<typeof deleteRequestSchema>;
export type DeactivateAccountInput = z.infer<typeof deactivateAccountSchema>;
