import { z } from 'zod';

import {
  RAG_JURISDICTIONS,
  RAG_LEGAL_DOMAINS,
  RAG_PATHWAY_CATEGORIES,
  RAG_SOURCE_CATEGORIES,
  RAG_SOURCE_RELIABILITIES,
  RAG_SOURCE_STATUSES,
  RAG_SOURCE_TYPES,
  RAG_STATE_OR_TERRITORIES,
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
  'constitutional_law',
  'constitutional',
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
const stateOrTerritorySchema = z.enum(RAG_STATE_OR_TERRITORIES).optional();
const legalDomainSchema = z.enum(RAG_LEGAL_DOMAINS).optional();
const pathwayCategorySchema = z.enum(RAG_PATHWAY_CATEGORIES).optional();
const sourceReliabilitySchema = z.enum(RAG_SOURCE_RELIABILITIES).default('unknown');
const ocrReviewApprovalSchema = z.object({
  legalReviewed: z.boolean().default(true)
});
const ocrPreviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(5)
});
const runOcrKnowledgeSourceSchema = z.object({
  maxPages: z.coerce.number().int().min(0).optional(),
  batchSize: z.coerce.number().int().min(1).optional(),
  pageTimeoutMs: z.coerce.number().int().min(1).optional(),
  jobTimeoutMs: z.coerce.number().int().min(0).optional(),
  force: z.boolean().default(false)
});

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
  sourceIds: z.array(objectIdSchema).max(20).optional(),
  stateOrTerritory: stateOrTerritorySchema,
  legalDomain: legalDomainSchema,
  pathwayCategory: pathwayCategorySchema,
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
  sourceId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200),
  sourceTitle: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  sourceCategory: ragSourceCategorySchema,
  jurisdiction: z.enum(RAG_JURISDICTIONS),
  stateOrTerritory: stateOrTerritorySchema,
  pathwayCategory: pathwayCategorySchema,
  legalDomain: legalDomainSchema,
  topic: ragTopicSchema,
  legislationName: z.string().trim().max(200).optional(),
  sourceType: z.enum(RAG_SOURCE_TYPES),
  sourceAuthority: z.string().trim().max(200).optional(),
  officialUrl: z.string().url().optional(),
  country: z.string().trim().max(80).optional(),
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
  active: z.boolean().default(true),
  sourceReliability: sourceReliabilitySchema,
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

export const ragDebugRetrieveSchema = ragSearchSchema.extend({
  topK: z.number().int().min(1).max(20).default(5)
});

export const rejectKnowledgeSourceSchema = z.object({
  reason: z.string().trim().min(1).max(1000)
});

export const approveOcrKnowledgeSourceSchema = ocrReviewApprovalSchema;
export const runOcrKnowledgeSourceRequestSchema = runOcrKnowledgeSourceSchema;
export const knowledgeSourceOcrPreviewQuerySchema = ocrPreviewQuerySchema;

export type RagSearchInput = z.infer<typeof ragSearchSchema>;
export type RagAnswerInput = z.infer<typeof ragAnswerSchema>;
export type RagTimelineAssistantInput = z.infer<typeof ragTimelineAssistantSchema>;
export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceSchema>;
export type UpdateKnowledgeSourceInput = z.infer<typeof updateKnowledgeSourceSchema>;
export type IngestKnowledgeSourceInput = z.infer<typeof ingestKnowledgeSourceSchema>;
export type RefreshKnowledgeSourceInput = z.infer<typeof refreshKnowledgeSourceSchema>;
export type RejectKnowledgeSourceInput = z.infer<typeof rejectKnowledgeSourceSchema>;
export type KnowledgeSourceChunkQueryInput = z.infer<typeof knowledgeSourceChunkQuerySchema>;
export type RagDebugRetrieveInput = z.infer<typeof ragDebugRetrieveSchema>;
export type ApproveOcrKnowledgeSourceInput = z.infer<typeof approveOcrKnowledgeSourceSchema>;
export type RunOcrKnowledgeSourceInput = z.infer<typeof runOcrKnowledgeSourceRequestSchema>;
export type KnowledgeSourceOcrPreviewQueryInput = z.infer<typeof knowledgeSourceOcrPreviewQuerySchema>;
