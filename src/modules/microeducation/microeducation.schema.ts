import { z } from 'zod';

import {
  MICRO_EDUCATION_CHIPS,
  MICRO_EDUCATION_DURATIONS,
  MICRO_EDUCATION_FORMATS,
  MICRO_EDUCATION_INCIDENT_CATEGORIES,
  MICRO_EDUCATION_STATUSES,
  MICRO_EDUCATION_TONES
} from './microeducation.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

const toChipList = (items: unknown[]): string[] =>
  items.filter((item): item is string => typeof item === 'string');

const toStringList = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return toChipList(value);
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [];
  }

  try {
    const parsedValue: unknown = JSON.parse(trimmedValue);

    if (Array.isArray(parsedValue)) {
      return toChipList(parsedValue);
    }
  } catch {
    return trimmedValue.split('|').map((item) => item.trim()).filter(Boolean);
  }

  return trimmedValue.split('|').map((item) => item.trim()).filter(Boolean);
};

const chipsSchema = z.preprocess(
  toStringList,
  z.array(z.enum(MICRO_EDUCATION_CHIPS)).min(1).max(4).default(['safety'])
);

const incidentCategoriesSchema = z.preprocess(
  toStringList,
  z.array(z.enum(MICRO_EDUCATION_INCIDENT_CATEGORIES)).max(5).default([])
);

const matchKeywordsSchema = z.preprocess(
  toStringList,
  z.array(z.string().trim().min(1).max(60)).max(12).default([])
);

export const microEducationParamsSchema = z.object({
  id: objectIdSchema
});

export const microEducationAdminQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(MICRO_EDUCATION_STATUSES).optional(),
  categoryId: objectIdSchema.optional()
});

export const microEducationPublicQuerySchema = z.object({
  categoryId: objectIdSchema.optional()
});

export const createMicroEducationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(900),
  readTimeLabel: z.string().trim().min(1).max(40).default('4 min read'),
  tag: z.string().trim().min(1).max(80).default('Safety'),
  cta: z.string().trim().min(1).max(80).default('Start Now'),
  detailHeading: z.string().trim().min(1).max(220).default('Safety overview'),
  detailSummary: z.string().trim().max(1200).optional(),
  detailBody: z.string().trim().min(1).max(4000).default('Review the guidance and choose the next safe step that fits your situation.'),
  detailTakeaway: z.string().trim().min(1).max(900).default('Keep notes simple, factual, and stored somewhere safe.'),
  imageAlt: z.string().trim().max(180).optional(),
  categoryId: objectIdSchema.optional(),
  tone: z.enum(MICRO_EDUCATION_TONES).default('blue'),
  chips: chipsSchema,
  incidentCategories: incidentCategoriesSchema,
  matchKeywords: matchKeywordsSchema,
  duration: z.enum(MICRO_EDUCATION_DURATIONS).default('quick'),
  format: z.enum(MICRO_EDUCATION_FORMATS).default('guide'),
  status: z.enum(MICRO_EDUCATION_STATUSES).default('draft'),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  views: z.coerce.number().int().min(0).max(100000000).default(0)
});

export const updateMicroEducationSchema = createMicroEducationSchema.partial();

export type MicroEducationAdminQueryInput = z.infer<typeof microEducationAdminQuerySchema>;
export type MicroEducationPublicQueryInput = z.infer<typeof microEducationPublicQuerySchema>;
export type CreateMicroEducationInput = z.infer<typeof createMicroEducationSchema>;
export type UpdateMicroEducationInput = z.infer<typeof updateMicroEducationSchema>;
