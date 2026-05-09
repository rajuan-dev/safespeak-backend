import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const contentSchema = z.string().trim().min(1).max(20000);

export const scamShieldParamsSchema = z.object({
  id: objectIdSchema
});

export const analyzeTextSchema = z.object({
  text: contentSchema,
  reportId: objectIdSchema.optional(),
  language: z.string().trim().min(2).max(12).default('en'),
  metadata: z.record(z.unknown()).default({})
});

export const analyzeEmailSchema = z.object({
  subject: z.string().trim().max(500).optional(),
  from: z.string().trim().max(320).optional(),
  body: contentSchema,
  headers: z.record(z.unknown()).default({}),
  reportId: objectIdSchema.optional(),
  metadata: z.record(z.unknown()).default({})
});

export const analyzeScreenshotSchema = z.object({
  imageText: contentSchema,
  evidenceId: objectIdSchema.optional(),
  reportId: objectIdSchema.optional(),
  metadata: z.record(z.unknown()).default({})
});

export const checkUrlSchema = z.object({
  url: z.string().url(),
  reportId: objectIdSchema.optional(),
  metadata: z.record(z.unknown()).default({})
});

export const redactScamContentSchema = z.object({
  text: contentSchema,
  replacement: z.enum(['mask', 'labels']).default('labels')
});

export const generateReportDraftSchema = z.object({
  analysisId: objectIdSchema,
  notes: z.string().trim().max(4000).optional()
});

export const submitScamReportSchema = z.object({
  analysisId: objectIdSchema,
  destination: z.string().trim().min(1).max(120).default('SafeSpeak review queue'),
  consentToShare: z.boolean().default(false)
});

export type AnalyzeTextInput = z.infer<typeof analyzeTextSchema>;
export type AnalyzeEmailInput = z.infer<typeof analyzeEmailSchema>;
export type AnalyzeScreenshotInput = z.infer<typeof analyzeScreenshotSchema>;
export type CheckUrlInput = z.infer<typeof checkUrlSchema>;
export type RedactScamContentInput = z.infer<typeof redactScamContentSchema>;
export type GenerateReportDraftInput = z.infer<typeof generateReportDraftSchema>;
export type SubmitScamReportInput = z.infer<typeof submitScamReportSchema>;
