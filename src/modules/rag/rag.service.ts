import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { StatusCodes } from 'http-status-codes';
import type { FilterQuery, HydratedDocument, PipelineStage } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createEmbedding, answerWithContext } from '@modules/ai/ai.service';
import type { AiCitation } from '@modules/ai/ai.types';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import { DEFAULT_RAG_TOP_K, RAG_ACTIONS, RAG_CHUNK_OVERLAP, RAG_CHUNK_SIZE } from './rag.constants';
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
  RejectKnowledgeSourceInput,
  UpdateKnowledgeSourceInput
} from './rag.schema';
import type { RagOwner, RagSearchResult, RagServiceContext } from './rag.types';

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
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai consent is required for AI processing'
    );
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
  const source = await RagKnowledgeSourceModel.findOne({
    _id: sourceId,
    deletedAt: {
      $exists: false
    }
  });

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
  RagKnowledgeSourceModel.find({
    deletedAt: {
      $exists: false
    }
  })
    .sort({ createdAt: -1 })
    .lean();

export const createKnowledgeSource = async (
  context: RagServiceContext,
  input: CreateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await RagKnowledgeSourceModel.create({
    ...input,
    createdBy: context.owner.userId
  });

  await auditRagAction(context, RAG_ACTIONS.sourceCreate, source._id.toString(), {
    sourceType: source.sourceType
  });

  return source;
};

export const updateKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: UpdateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.set(input);
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceUpdate, source._id.toString(), {
    changedFields: Object.keys(input)
  });

  return source;
};

export const deleteKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<void> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.status = 'archived';
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
  const contentHash = hashText(text);

  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== contentHash) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Knowledge source SHA-256 verification failed');
  }

  const chunks = chunkText(text);
  await RagChunkModel.deleteMany({ sourceId: source._id });

  const embeddedChunks = await Promise.all(
    chunks.map(async (chunk, index) => ({
      sourceId: source._id,
      chunkIndex: index,
      text: chunk,
      embedding: await createEmbedding(chunk),
      contentHash: hashText(chunk),
      metadata: {
        ...input.metadata,
        sourceTitle: source.title,
        sourceType: source.sourceType,
        language: source.language,
        jurisdiction: source.jurisdiction
      }
    }))
  );

  if (embeddedChunks.length > 0) {
    await RagChunkModel.insertMany(embeddedChunks);
  }

  source.contentHash = contentHash;
  source.rawText = text;
  source.status = 'pending_review';
  source.ingestedAt = new Date();
  source.metadata = {
    ...source.metadata,
    ...input.metadata,
    chunkCount: embeddedChunks.length,
    sha256Verified: true
  };
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
    chunkCount: embeddedChunks.length,
    contentHash,
    requiresHumanReview: true
  });

  return {
    source,
    chunkCount: embeddedChunks.length,
    contentHash,
    reviewStatus: 'pending_human_review'
  };
};

export const approveKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
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

  await auditRagAction(context, RAG_ACTIONS.sourceReject, source._id.toString(), {
    reason: input.reason
  });

  return source;
};

export const reindexKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
  const source = await getSource(sourceId);

  if (!source.rawText) {
    throw new ApiError(StatusCodes.CONFLICT, 'Knowledge source has no ingested text to reindex');
  }

  const result = await ingestKnowledgeSource(context, sourceId, {
    content: source.rawText,
    expectedSha256: source.contentHash,
    metadata: source.metadata
  });

  await auditRagAction(context, RAG_ACTIONS.sourceReindex, source._id.toString());

  return result;
};

const buildSourceFilter = (input: RagSearchInput): FilterQuery<RagKnowledgeSourceDocument> => ({
  status: 'approved',
  deletedAt: {
    $exists: false
  },
  ...(input.language ? { language: input.language } : {}),
  ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
  ...(input.sourceType ? { sourceType: input.sourceType } : {})
});

export const searchRag = async (
  context: RagServiceContext,
  input: RagSearchInput
): Promise<RagSearchResult[]> => {
  await assertAiConsent(context.owner);
  const queryVector = await createEmbedding(input.query);
  const sourceFilter = buildSourceFilter(input);
  const sourceIds = await RagKnowledgeSourceModel.find(sourceFilter).distinct('_id');

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
        filter: {
          sourceId: {
            $in: sourceIds
          }
        }
      }
    },
    {
      $lookup: {
        from: 'ragknowledgesources',
        localField: 'sourceId',
        foreignField: '_id',
        as: 'source'
      }
    },
    {
      $unwind: '$source'
    },
    {
      $project: {
        _id: 1,
        sourceId: 1,
        text: 1,
        metadata: 1,
        score: {
          $meta: 'vectorSearchScore'
        },
        'source.title': 1,
        'source.sourceType': 1
      }
    }
  ];

  const results = await RagChunkModel.aggregate<{
    _id: { toString(): string };
    sourceId: { toString(): string };
    text: string;
    score?: number;
    metadata?: Record<string, unknown>;
    source: {
      title: string;
      sourceType: RagSearchResult['sourceType'];
    };
  }>(pipeline);

  await auditRagAction(context, RAG_ACTIONS.search, undefined, {
    resultCount: results.length,
    topK: input.topK ?? DEFAULT_RAG_TOP_K
  });

  return results.map((result) => ({
    chunkId: result._id.toString(),
    sourceId: result.sourceId.toString(),
    title: result.source.title,
    sourceType: result.source.sourceType,
    text: result.text,
    score: result.score,
    metadata: result.metadata ?? {}
  }));
};

export const answerRag = async (
  context: RagServiceContext,
  input: RagAnswerInput
): Promise<Record<string, unknown>> => {
  const results = await searchRag(context, {
    ...input,
    query: input.question
  });
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));
  const contextText = results
    .map((result, index) => `[${index + 1}] ${result.title} (${result.sourceId}): ${result.text}`)
    .join('\n\n');

  const answer = await answerWithContext(context, {
    question: input.question,
    language: input.language,
    citations,
    contextText
  });

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    citationCount: citations.length
  });

  return answer;
};
