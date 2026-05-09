import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const languageSchema = z.string().trim().min(2).max(12).default('en');
const narrativeSchema = z.string().trim().min(1).max(12000);

const baseAiSchema = z.object({
  reportId: objectIdSchema.optional(),
  language: languageSchema.optional()
});

export const extractIncidentFieldsSchema = baseAiSchema.extend({
  narrative: narrativeSchema,
  jurisdiction: z.string().trim().max(120).optional()
});

export const triageReportSchema = baseAiSchema.extend({
  narrative: narrativeSchema.optional(),
  structuredFields: z.record(z.unknown()).optional()
});

export const clarifyingQuestionsSchema = baseAiSchema.extend({
  narrative: narrativeSchema,
  structuredFields: z.record(z.unknown()).optional(),
  maxQuestions: z.number().int().min(1).max(10).default(5)
});

export const generateSummarySchema = baseAiSchema.extend({
  narrative: narrativeSchema.optional(),
  structuredFields: z.record(z.unknown()).optional(),
  audience: z.enum(['user', 'support_worker', 'reviewer']).default('user')
});

export const translateSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  sourceLanguage: z.string().trim().min(2).max(40).optional(),
  targetLanguage: z.string().trim().min(2).max(40).default('English')
});

export const redactPiiSchema = z.object({
  text: z.string().trim().min(1).max(12000),
  language: languageSchema.optional(),
  replacementStyle: z.enum(['labels', 'mask']).default('labels')
});

export const transcribeAudioBodySchema = z.object({
  reportId: objectIdSchema.optional(),
  evidenceId: objectIdSchema.optional(),
  language: z.string().trim().min(2).max(40).optional(),
  saveTranscript: z.preprocess((value) => {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return value;
  }, z.boolean().optional()),
  useAsNarrative: z.preprocess((value) => {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return value;
  }, z.boolean().optional())
});

export type ExtractIncidentFieldsInput = z.infer<typeof extractIncidentFieldsSchema>;
export type TriageReportInput = z.infer<typeof triageReportSchema>;
export type ClarifyingQuestionsInput = z.infer<typeof clarifyingQuestionsSchema>;
export type GenerateSummaryInput = z.infer<typeof generateSummarySchema>;
export type TranslateInput = z.infer<typeof translateSchema>;
export type RedactPiiInput = z.infer<typeof redactPiiSchema>;
export type TranscribeAudioBodyInput = z.infer<typeof transcribeAudioBodySchema>;
