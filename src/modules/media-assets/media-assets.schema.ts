import { z } from 'zod';

import { MEDIA_ASSET_STATUSES } from './media-assets.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalTrimmedString = (minimumLength = 1, maximumLength = 5000) =>
  z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(minimumLength).max(maximumLength).optional()
  );

const optionalDate = z.preprocess(
  emptyStringToUndefined,
  z.coerce.date().optional()
);

const optionalBooleanFromString = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return value;
}, z.boolean().optional());

export const mediaAssetParamsSchema = z.object({
  id: objectIdSchema
});

export const mediaAssetQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(MEDIA_ASSET_STATUSES).optional()
});

export const createMediaAssetSchema = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().min(1).max(180),
  bodyText: z.string().trim().min(1).max(5000),
  category: z.string().trim().min(1).max(80),
  createdDate: optionalDate,
  expirationDate: optionalDate,
  offlineCachingEnabled: optionalBooleanFromString.default(false),
  primaryCta: optionalTrimmedString(1, 120),
  secondaryButton: optionalTrimmedString(1, 120),
  status: z.enum(MEDIA_ASSET_STATUSES).default('published')
});

export const updateMediaAssetSchema = z.object({
  title: optionalTrimmedString(1, 120),
  subtitle: optionalTrimmedString(1, 180),
  bodyText: optionalTrimmedString(1, 5000),
  category: optionalTrimmedString(1, 80),
  createdDate: optionalDate,
  expirationDate: optionalDate,
  offlineCachingEnabled: optionalBooleanFromString,
  primaryCta: optionalTrimmedString(1, 120),
  secondaryButton: optionalTrimmedString(1, 120),
  status: z.enum(MEDIA_ASSET_STATUSES).optional()
});

export type MediaAssetParamsInput = z.infer<typeof mediaAssetParamsSchema>;
export type MediaAssetQueryInput = z.infer<typeof mediaAssetQuerySchema>;
export type CreateMediaAssetInput = z.infer<typeof createMediaAssetSchema>;
export type UpdateMediaAssetInput = z.infer<typeof updateMediaAssetSchema>;
