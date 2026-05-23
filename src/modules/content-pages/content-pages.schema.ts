import { z } from 'zod';

import { CONTENT_PAGE_KEYS } from './content-pages.constants';

const shortTextSchema = z.string().trim().min(1).max(240);
const mediumTextSchema = z.string().trim().min(1).max(1000);
const urlPathSchema = z.string().trim().min(1).max(300);
const legalHtmlSchema = z
  .string()
  .trim()
  .min(1)
  .max(50000)
  .refine(
    (value) => !/<\s*(script|iframe|object|embed)\b/i.test(value),
    'Unsupported HTML tag'
  )
  .refine(
    (value) => !/\son[a-z]+\s*=/i.test(value),
    'Unsupported HTML attribute'
  )
  .refine(
    (value) => !/javascript:/i.test(value),
    'Unsupported URL protocol'
  );

export const contentPageParamsSchema = z.object({
  key: z.enum(CONTENT_PAGE_KEYS)
});

export const landingPageContentSchema = z.object({
  heroHeadline: shortTextSchema,
  subheading: mediumTextSchema,
  primaryButtonLabel: shortTextSchema.max(80),
  primaryButtonUrl: urlPathSchema,
  secondaryButtonLabel: shortTextSchema.max(80).optional(),
  secondaryButtonUrl: urlPathSchema.optional(),
  backgroundVisualsEnabled: z.boolean().default(true)
});

export const legalDocumentContentSchema = z.object({
  contentHtml: legalHtmlSchema,
  imageOriginalFileName: z.string().trim().max(255).optional()
});

export const aboutPageContentSchema = z.object({
  eyebrow: shortTextSchema.max(120),
  title: shortTextSchema,
  body: mediumTextSchema.max(2400),
  commitments: z.array(mediumTextSchema.max(500)).min(1).max(12)
});

export const contentPageUpdateSchema = z.object({
  content: z.record(z.unknown())
});

export type ContentPageParamsInput = z.infer<typeof contentPageParamsSchema>;
export type ContentPageUpdateInput = z.infer<typeof contentPageUpdateSchema>;
