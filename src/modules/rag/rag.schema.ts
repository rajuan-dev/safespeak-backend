import { z } from 'zod';

import { RAG_SOURCE_TYPES } from './rag.constants';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const ragParamsSchema = z.object({
  id: objectIdSchema
});

export const ragSearchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(20).default(5),
  language: z.string().trim().min(2).max(12).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  sourceType: z.enum(RAG_SOURCE_TYPES).optional(),
  filters: z.record(z.unknown()).optional()
});

export const ragAnswerSchema = ragSearchSchema.extend({
  question: z.string().trim().min(1).max(2000)
});

export const createKnowledgeSourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  sourceType: z.enum(RAG_SOURCE_TYPES),
  jurisdiction: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(12).default('en'),
  url: z.string().url().optional(),
  metadata: z.record(z.unknown()).default({})
});

export const updateKnowledgeSourceSchema = createKnowledgeSourceSchema.partial();

export const ingestKnowledgeSourceSchema = z
  .object({
    content: z.string().trim().min(1).max(200000).optional(),
    localFilePath: z.string().trim().min(1).max(1000).optional(),
    expectedSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
    metadata: z.record(z.unknown()).default({})
  })
  .refine((value) => Boolean(value.content || value.localFilePath), {
    message: 'content or localFilePath is required'
  });

export const rejectKnowledgeSourceSchema = z.object({
  reason: z.string().trim().min(1).max(1000)
});

export type RagSearchInput = z.infer<typeof ragSearchSchema>;
export type RagAnswerInput = z.infer<typeof ragAnswerSchema>;
export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceSchema>;
export type UpdateKnowledgeSourceInput = z.infer<typeof updateKnowledgeSourceSchema>;
export type IngestKnowledgeSourceInput = z.infer<typeof ingestKnowledgeSourceSchema>;
export type RejectKnowledgeSourceInput = z.infer<typeof rejectKnowledgeSourceSchema>;
