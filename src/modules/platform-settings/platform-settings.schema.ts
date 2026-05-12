import { z } from 'zod';

const textSchema = z.string().trim().min(1).max(600);
const templateTextSchema = z.string().trim().min(1).max(2400);

export const platformSettingsPayloadSchema = z.object({
  safety: z.object({
    immediateDangerText: textSchema,
    respectSupportText: textSchema,
    platformRoleText: textSchema,
    informationOnlyText: textSchema,
    emergencyCallLabel: textSchema.max(80),
    respectCallLabel: textSchema.max(80),
    quickExitLabel: textSchema.max(80),
    covertModeLabel: textSchema.max(80)
  }),
  consent: z.object({
    introText: textSchema,
    localStorageLabel: textSchema.max(120),
    cloudSyncLabel: textSchema.max(120),
    agencySharingLabel: textSchema.max(120),
    analyticsLabel: textSchema.max(120)
  }),
  ai: z.object({
    disclaimerText: textSchema,
    humanReviewText: textSchema,
    triageSystemPrompt: templateTextSchema,
    triageResponseTemplate: templateTextSchema,
    triageFallbackText: templateTextSchema,
    triageTemplateStatus: z.enum(['draft', 'approved']).default('draft')
  })
});

export const updatePlatformSettingsDraftSchema = platformSettingsPayloadSchema.deepPartial();

export type PlatformSettingsPayloadInput = z.infer<typeof platformSettingsPayloadSchema>;
export type UpdatePlatformSettingsDraftInput = z.infer<typeof updatePlatformSettingsDraftSchema>;
