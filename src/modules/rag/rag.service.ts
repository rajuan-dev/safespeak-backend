import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { StatusCodes } from 'http-status-codes';
import type { FilterQuery, HydratedDocument, PipelineStage } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import {
  buildInformationOnlyDisclaimer,
  detectCrisisRisk,
  detectLegalAdviceRisk,
  enforceAiOutputGuardrails,
  shouldRequireHumanReview
} from '@modules/ai/ai-guardrails';
import {
  answerWithContext,
  createEmbedding,
  generateTimelineAssistantTurn
} from '@modules/ai/ai.service';
import type { AiCitation } from '@modules/ai/ai.types';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import {
  DEFAULT_RAG_TOP_K,
  RAG_ACTIONS,
  RAG_CHUNK_OVERLAP,
  RAG_CHUNK_SIZE
} from './rag.constants';
import {
  RagChunkModel,
  RagKnowledgeSourceModel,
  type RagKnowledgeSourceDocument
} from './rag.model';
import type {
  CreateKnowledgeSourceInput,
  IngestKnowledgeSourceInput,
  RagAnswerInput,
  RagSearchInput,
  RagTimelineAssistantInput,
  RejectKnowledgeSourceInput,
  UpdateKnowledgeSourceInput
} from './rag.schema';
import type { RagOwner, RagSearchResult, RagServiceContext, RagSourceCategory } from './rag.types';

const ownerFilter = (owner: RagOwner): RagOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');

const assertAiConsent = async (owner: RagOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'process_with_ai consent is required for AI processing');
  }
};

const auditRagAction = async (
  context: RagServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.actorType ?? (context.owner.userId ? 'user' : 'anonymous_session'),
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

type HydratedRagKnowledgeSourceDocument = HydratedDocument<RagKnowledgeSourceDocument>;

const getSource = async (sourceId: string): Promise<HydratedRagKnowledgeSourceDocument> => {
  const source = await RagKnowledgeSourceModel.findOne({ _id: sourceId, deletedAt: { $exists: false } });

  if (!source) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Knowledge source not found');
  }

  return source;
};

const chunkText = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    chunks.push(normalized.slice(cursor, cursor + RAG_CHUNK_SIZE));
    cursor += RAG_CHUNK_SIZE - RAG_CHUNK_OVERLAP;
  }

  return chunks;
};

const readIngestionText = async (input: IngestKnowledgeSourceInput): Promise<string> => {
  if (input.content) {
    return input.content;
  }

  if (!input.localFilePath) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'content or localFilePath is required');
  }

  return readFile(input.localFilePath, 'utf8');
};

export const listKnowledgeSources = async (): Promise<unknown[]> =>
  RagKnowledgeSourceModel.find({ deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();

export const createKnowledgeSource = async (
  context: RagServiceContext,
  input: CreateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);

  if (input.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Knowledge sources must be approved through the review workflow'
    );
  }

  const source = await RagKnowledgeSourceModel.create({ ...input, createdBy: context.owner.userId });

  await auditRagAction(context, RAG_ACTIONS.sourceCreate, source._id.toString(), {
    sourceType: source.sourceType,
    sourceCategory: source.sourceCategory
  });

  return source;
};

export const updateKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: UpdateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);

  if (input.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Use the approval endpoint to approve a knowledge source'
    );
  }

  const source = await getSource(sourceId);
  source.set(input);
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceUpdate, source._id.toString(), {
    changedFields: Object.keys(input)
  });

  return source;
};

export const deleteKnowledgeSource = async (context: RagServiceContext, sourceId: string): Promise<void> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.status = 'expired';
  source.deletedAt = new Date();
  await source.save();
  await RagChunkModel.deleteMany({ sourceId: source._id });

  await auditRagAction(context, RAG_ACTIONS.sourceDelete, source._id.toString());
};

export const ingestKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: IngestKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  const text = await readIngestionText(input);
  const sha256Hash = hashText(text);

  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256Hash) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Knowledge source SHA-256 verification failed');
  }

  const chunks = chunkText(text);
  await RagChunkModel.deleteMany({ sourceId: source._id });

  const embeddedChunks = await Promise.all(
    chunks.map(async (chunk, index) => ({
      sourceId: source._id,
      sourceCategory: source.sourceCategory,
      jurisdiction: source.jurisdiction,
      topic: source.topic,
      sectionRef: undefined,
      chunkIndex: index,
      chunkText: chunk,
      embedding: await createEmbedding(chunk),
      tokenCount: Math.ceil(chunk.length / 4),
      citationLabel: `${source.title} [chunk ${index + 1}]`,
      citationUrl: source.url,
      metadata: {
        ...input.metadata,
        sourceTitle: source.title,
        sourceType: source.sourceType,
        sourceCategory: source.sourceCategory,
        language: source.language,
        jurisdiction: source.jurisdiction
      }
    }))
  );

  if (embeddedChunks.length > 0) {
    await RagChunkModel.insertMany(embeddedChunks);
  }

  source.sha256Hash = sha256Hash;
  source.rawText = text;
  source.status = source.sourceCategory === 'internal_product_rule' ? source.status : 'pending_review';
  source.ingestedAt = new Date();
  source.version = (source.version ?? 1) + 1;
  source.metadata = { ...source.metadata, ...input.metadata, chunkCount: embeddedChunks.length, sha256Verified: true };
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
    chunkCount: embeddedChunks.length,
    sha256Hash,
    requiresHumanReview: source.status !== 'approved'
  });

  return { source, chunkCount: embeddedChunks.length, sha256Hash, reviewStatus: 'pending_human_review' };
};

export const approveKnowledgeSource = async (context: RagServiceContext, sourceId: string): Promise<unknown> => {
  const owner = ownerFilter(context.owner);
  const source = await getSource(sourceId);

  if (source.createdBy && owner.userId && source.createdBy.toString() === owner.userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Knowledge sources must be approved by a different admin'
    );
  }

  source.status = 'approved';
  source.approvedBy = context.owner.userId as never;
  source.approvedAt = new Date();
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceApprove, source._id.toString());

  return source;
};

export const rejectKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: RejectKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.status = 'rejected';
  source.rejectedBy = context.owner.userId as never;
  source.rejectedAt = new Date();
  source.rejectionReason = input.reason;
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceReject, source._id.toString(), { reason: input.reason });

  return source;
};

export const reindexKnowledgeSource = async (context: RagServiceContext, sourceId: string): Promise<unknown> => {
  const source = await getSource(sourceId);

  if (!source.rawText) {
    throw new ApiError(StatusCodes.CONFLICT, 'Knowledge source has no ingested text to reindex');
  }

  const result = await ingestKnowledgeSource(context, sourceId, {
    content: source.rawText,
    expectedSha256: source.sha256Hash,
    metadata: source.metadata
  });

  await auditRagAction(context, RAG_ACTIONS.sourceReindex, source._id.toString());

  return result;
};

const classifySourceCategory = (input: RagAnswerInput | RagSearchInput): RagSourceCategory => {
  if (input.sourceCategory) {
    return input.sourceCategory;
  }

  const q = ('question' in input ? input.question : input.query).toLowerCase();
  if (/(law|legal|legislation|act|rights|court|discrimination)/i.test(q)) return 'official_legal_source';
  if (/(support|helpline|000|1800respect|lifeline|reportcyber|scamwatch)/i.test(q)) return 'official_support_source';
  return 'internal_product_rule';
};

const buildSourceFilter = (input: RagSearchInput, category: RagSourceCategory): FilterQuery<RagKnowledgeSourceDocument> => ({
  status: 'approved',
  deletedAt: { $exists: false },
  sourceCategory: category,
  ...(input.language ? { language: input.language } : {}),
  ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
  ...(input.topic ? { topic: input.topic } : {})
});

export const searchRag = async (context: RagServiceContext, input: RagSearchInput): Promise<RagSearchResult[]> => {
  await assertAiConsent(context.owner);
  const queryVector = await createEmbedding(input.query);
  const sourceCategory = classifySourceCategory(input);
  const sourceFilter = buildSourceFilter(input, sourceCategory);
  const sourceIds = await RagKnowledgeSourceModel.find(sourceFilter).sort({ lastUpdated: -1 }).distinct('_id');

  if (sourceIds.length === 0) {
    return [];
  }

  const pipeline: PipelineStage[] = [
    {
      $vectorSearch: {
        index: env.RAG_VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max((input.topK ?? DEFAULT_RAG_TOP_K) * 10, 50),
        limit: input.topK ?? DEFAULT_RAG_TOP_K,
        filter: { sourceId: { $in: sourceIds }, sourceCategory }
      }
    },
    { $lookup: { from: 'ragknowledgesources', localField: 'sourceId', foreignField: '_id', as: 'source' } },
    { $unwind: '$source' },
    {
      $project: {
        _id: 1,
        sourceId: 1,
        chunkText: 1,
        sectionRef: 1,
        citationUrl: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' },
        'source.title': 1,
        'source.publisher': 1,
        'source.sourceCategory': 1,
        'source.sourceType': 1,
        'source.topic': 1,
        'source.jurisdiction': 1,
        'source.lastUpdated': 1
      }
    }
  ];

  type RagAggregateResult = {
    _id: { toString(): string };
    sourceId: { toString(): string };
    chunkText: string;
    sectionRef?: string;
    citationUrl?: string;
    metadata?: Record<string, unknown>;
    score?: number;
    source: {
      title: string;
      publisher: string;
      sourceCategory: RagSourceCategory;
      sourceType: RagSearchResult['sourceType'];
      topic: RagSearchResult['topic'];
      jurisdiction: RagSearchResult['jurisdiction'];
      lastUpdated?: Date;
    };
  };
  const results = await RagChunkModel.aggregate<RagAggregateResult>(pipeline);
  await auditRagAction(context, RAG_ACTIONS.search, undefined, { resultCount: results.length, topK: input.topK ?? DEFAULT_RAG_TOP_K });

  return results.map((result) => ({
    chunkId: result._id.toString(),
    sourceId: result.sourceId.toString(),
    title: result.source.title,
    publisher: result.source.publisher,
    sourceCategory: result.source.sourceCategory,
    sourceType: result.source.sourceType,
    jurisdiction: result.source.jurisdiction,
    topic: result.source.topic,
    sectionRef: result.sectionRef,
    citationUrl: result.citationUrl,
    lastUpdated: result.source.lastUpdated,
    text: result.chunkText,
    score: result.score,
    metadata: result.metadata ?? {}
  }));
};

export const answerRag = async (context: RagServiceContext, input: RagAnswerInput): Promise<Record<string, unknown>> => {
  const category = classifySourceCategory(input);
  const results = await searchRag(context, { ...input, query: input.question, sourceCategory: category });
  const insufficientSources = results.length === 0;
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));

  const safetySeedText = `${input.question}\n${results.map((r) => r.text).join('\n')}`;
  const legalAdviceRisk = detectLegalAdviceRisk(safetySeedText);
  const crisisRisk = detectCrisisRisk(safetySeedText);
  const pendingHumanReview = shouldRequireHumanReview({ legalAdviceRisk, crisisRisk, insufficientSources });

  if (insufficientSources) {
    return {
      answer: 'SafeSpeak does not have enough approved authoritative information to answer this confidently right now.',
      disclaimer: buildInformationOnlyDisclaimer(),
      citations: [],
      sourceCategoriesUsed: [],
      confidence: 'low',
      pendingHumanReview,
      safetyFlags: { crisisRisk, legalAdviceRisk, insufficientSources }
    };
  }

  const contextText = results.map((result, index) => `[${index + 1}] ${result.title}: ${result.text}`).join('\n\n');

  const modelResponse = await answerWithContext(context, {
    question: input.question,
    language: input.language,
    citations,
    contextText
  });

  const output = (modelResponse.output ?? {}) as Record<string, unknown>;
  const answerCandidate = output.answer ?? output.text;
  const answerText = enforceAiOutputGuardrails(
    typeof answerCandidate === 'string' ? answerCandidate : JSON.stringify(answerCandidate ?? '')
  );

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, { citationCount: results.length, sourceCategory: category });

  return {
    answer: answerText,
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: results.map((result) => ({
      title: result.title,
      publisher: result.publisher,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      sectionRef: result.sectionRef,
      lastUpdated: result.lastUpdated
    })),
    sourceCategoriesUsed: Array.from(new Set(results.map((result) => result.sourceCategory))),
    confidence: results.length >= 4 ? 'high' : results.length >= 2 ? 'medium' : 'low',
    pendingHumanReview,
    safetyFlags: { crisisRisk, legalAdviceRisk, insufficientSources }
  };
};

const normalizeTimelineValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const runTimelineAssistant = async (
  context: RagServiceContext,
  input: RagTimelineAssistantInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);

  let results: RagSearchResult[] = [];
  let ragUnavailable = false;

  try {
    results = await searchRag(context, {
      query: input.message,
      topK: input.topK,
      language: input.language,
      jurisdiction: input.jurisdiction
    });
  } catch {
    ragUnavailable = true;
  }

  const contextText = results
    .map((result, index) => `[${index + 1}] ${result.title}: ${result.text}`)
    .join('\n\n');
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));

  const modelResponse = await generateTimelineAssistantTurn(context, {
    message: input.message,
    conversation: input.conversation,
    timeline: input.timeline,
    language: input.language,
    contextText,
    citations,
    ragUnavailable
  });
  const output = (modelResponse.output ?? {}) as Record<string, unknown>;
  const timelineCandidate = (output.timeline ?? {}) as Record<string, unknown>;
  const assistantMessage =
    typeof output.assistantMessage === 'string' && output.assistantMessage.trim()
      ? enforceAiOutputGuardrails(output.assistantMessage)
      : enforceAiOutputGuardrails(
          'Thank you. Can you share one more detail that feels safe to add?'
        );

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    mode: 'timeline_assistant',
    citationCount: results.length,
    ragUnavailable
  });

  return {
    assistantMessage,
    nextQuestion:
      typeof output.nextQuestion === 'string' ? output.nextQuestion.trim() : '',
    timeline: {
      who: normalizeTimelineValue(timelineCandidate.who),
      what: normalizeTimelineValue(timelineCandidate.what),
      where: normalizeTimelineValue(timelineCandidate.where)
    },
    readyForSubmission: Boolean(output.readyForSubmission),
    confidence:
      output.confidence === 'high' || output.confidence === 'medium' || output.confidence === 'low'
        ? output.confidence
        : results.length >= 2
          ? 'medium'
          : 'low',
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: results.map((result) => ({
      title: result.title,
      publisher: result.publisher,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      sectionRef: result.sectionRef,
      lastUpdated: result.lastUpdated
    })),
    rag: {
      used: results.length > 0,
      unavailable: ragUnavailable,
      resultCount: results.length
    },
    reviewStatus: modelResponse.reviewStatus,
    interactionId: modelResponse.interactionId
  };
};
