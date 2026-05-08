import { z } from 'zod';

import { CONSENT_FLAGS } from './consent.constants';

const consentFlagsSchema = z
  .object(
    Object.fromEntries(CONSENT_FLAGS.map((flag) => [flag, z.boolean().optional()])) as Record<
      (typeof CONSENT_FLAGS)[number],
      z.ZodOptional<z.ZodBoolean>
    >
  )
  .strict();

export const updateConsentSchema = z.object({
  flags: consentFlagsSchema,
  source: z.string().min(1).max(80).default('user')
});

export const withdrawConsentSchema = z.object({
  flags: z.array(z.enum(CONSENT_FLAGS)).min(1),
  source: z.string().min(1).max(80).default('withdrawal')
});

export type UpdateConsentInput = z.infer<typeof updateConsentSchema>;
export type WithdrawConsentInput = z.infer<typeof withdrawConsentSchema>;
