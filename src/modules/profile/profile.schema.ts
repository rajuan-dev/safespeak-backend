import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    preferredLanguage: z.string().min(2).max(12).optional(),
    interpreterLanguage: z.string().min(2).max(80).optional(),
    jurisdiction: z.string().min(2).max(80).optional(),
    lga: z.string().max(120).optional(),
    culturalProfile: z.string().max(120).optional(),
    faithProfile: z.string().max(120).optional(),
    communityProfile: z.string().max(120).optional(),
    referralSharingPreference: z.boolean().optional(),
    accessibilityPreferences: z.record(z.unknown()).optional()
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
