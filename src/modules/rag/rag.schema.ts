import { z } from 'zod';

import {
  RAG_JURISDICTIONS,
  RAG_SOURCE_CATEGORIES,
  RAG_SOURCE_STATUSES,
  RAG_SOURCE_TYPES,
  RAG_TOPICS
} from './rag.constants';
import {
  normalizeSourceCategoryValue,
  normalizeTopicValue
} from './rag.normalization';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const sourceCategoryAliases = [
  'legislation',
  'legal',
  'regulation',
  'regulations',
  'support',
  'resources',
  'scam_pattern',
  'scam_patterns',
  'internal'
] as const;
const topicAliases = [
  'domestic_violence',
  'dv',
  'racial_abuse',
  'racial',
  'cyber_scam',
  'scam',
  'scamshield',
  'migrant_challenges',
  'migrant',
  'support',
  'resources',
  'local_intelligence',
  'smart_dialler'
] as const;
const acceptedSourceCategoryValues = Array.from(
  new Set([...RAG_SOURCE_CATEGORIES, ...sourceCategoryAliases])
);
const acceptedTopicValues = Array.from(new Set([...RAG_TOPICS, ...topicAliases]));
const ragSourceCategorySchema = z.preprocess(
  normalizeSourceCategoryValue,
  z.enum(RAG_SOURCE_CATEGORIES, {
    errorMap: () => ({
      message: `Invalid sourceCategory. Accepted values: ${acceptedSourceCategoryValues.join(', ')}`
    })
  })
);
const ragTopicSchema = z.preprocess(
  normalizeTopicValue,
  z.enum(RAG_TOPICS, {
    errorMap: () => ({
      message: `Invalid topic. Accepted values: ${acceptedTopicValues.join(', ')}`
    })
  })
);
const incidentCategorySchema = z.enum([
  'domestic_violence',
  'racial_abuse',
  'migrant_challenges',
  'cyber_scam'
]);

export const ragParamsSchema = z.object({ id: objectIdSchema });
export const knowledgeSourceChunkQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});

export const ragSearchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(20).default(5),
  language: z.string().trim().min(2).max(12).optional(),
  jurisdiction: z.enum(RAG_JURISDICTIONS).optional(),
  sourceCategory: ragSourceCategorySchema.optional(),
  topic: ragTopicSchema.optional(),
  filters: z.record(z.unknown()).optional()
});

export const ragAnswerSchema = ragSearchSchema.extend({
  question: z.string().trim().min(1).max(2000)
});

const timelineConversationMessageSchema = z.object({
  role: z.enum(['assistant', 'user']),
  content: z.string().trim().min(1).max(4000)
});

export const ragTimelineAssistantSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation: z.array(timelineConversationMessageSchema).max(100).default([]),
  timeline: z.record(z.unknown()).default({}),
  language: z.string().trim().min(2).max(12).optional(),
  incidentCategory: incidentCategorySchema.optional(),
  jurisdiction: z.enum(RAG_JURISDICTIONS).optional(),
  topK: z.number().int().min(1).max(8).default(4)
});

export const createKnowledgeSourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  sourceCategory: ragSourceCategorySchema,
  jurisdiction: z.enum(RAG_JURISDICTIONS),
  topic: ragTopicSchema,
  sourceType: z.enum(RAG_SOURCE_TYPES),
  language: z.string().trim().min(2).max(12).default('en'),
  url: z.string().url().optional(),
  localFilePath: z.string().trim().max(1000).optional(),
  publisher: z.string().trim().min(1).max(200),
  licenseStatus: z.string().trim().min(1).max(200),
  lastUpdated: z.coerce.date().optional(),
  lastVerifiedAt: z.coerce.date().optional(),
  nextReviewAt: z.coerce.date().optional(),
  nextRefreshAt: z.coerce.date().optional(),
  legalReviewed: z.boolean().default(false),
  reviewNotes: z.string().trim().max(2000).optional(),
  status: z.enum(RAG_SOURCE_STATUSES).default('draft'),
  version: z.number().int().min(1).default(1),
  metadata: z.record(z.unknown()).default({})
});

export const updateKnowledgeSourceSchema = createKnowledgeSourceSchema.partial();

export const ingestKnowledgeSourceSchema = z
  .object({
    content: z.string().trim().min(1).max(200000).optional(),
    localFilePath: z.string().trim().min(1).max(1000).optional(),
    expectedSha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
    metadata: z.record(z.unknown()).default({})
  });

export const refreshKnowledgeSourceSchema = z.object({
  content: z.string().trim().min(1).max(200000).optional(),
  localFilePath: z.string().trim().min(1).max(1000).optional(),
  expectedSha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  nextRefreshAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).default({})
});

export const rejectKnowledgeSourceSchema = z.object({
  reason: z.string().trim().min(1).max(1000)
});

export type RagSearchInput = z.infer<typeof ragSearchSchema>;
export type RagAnswerInput = z.infer<typeof ragAnswerSchema>;
export type RagTimelineAssistantInput = z.infer<typeof ragTimelineAssistantSchema>;
export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceSchema>;
export type UpdateKnowledgeSourceInput = z.infer<typeof updateKnowledgeSourceSchema>;
export type IngestKnowledgeSourceInput = z.infer<typeof ingestKnowledgeSourceSchema>;
export type RefreshKnowledgeSourceInput = z.infer<typeof refreshKnowledgeSourceSchema>;
export type RejectKnowledgeSourceInput = z.infer<typeof rejectKnowledgeSourceSchema>;
export type KnowledgeSourceChunkQueryInput = z.infer<typeof knowledgeSourceChunkQuerySchema>;
