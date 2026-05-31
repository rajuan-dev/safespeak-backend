import { StatusCodes } from 'http-status-codes';
import { Pinecone } from '@pinecone-database/pinecone';

import { ApiError } from '@common/errors/ApiError';
import { logger } from '@common/utils/logger';
import { env } from '@config/env';

import type {
  VectorChunkUpsertRecord,
  VectorSearchFilters,
  VectorSearchResult,
  VectorStore,
  VectorStoreHealth,
  VectorStoreSearchParams,
  VectorStoreUpsertParams
} from './vector-store.types';

type PineconeMetadataValue = string | number | boolean | string[];
type PineconeMetadata = Record<string, PineconeMetadataValue>;

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const getNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const getStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
};

export const isPineconeConfigured = (): boolean => Boolean(env.PINECONE_API_KEY);

export const getPineconeIndexName = (): string => env.PINECONE_INDEX_NAME;
export const getPineconeNamespace = (): string => env.PINECONE_NAMESPACE;
export const getExpectedEmbeddingDimension = (): number | undefined =>
  env.OPENAI_EMBEDDING_MODEL === 'text-embedding-3-small'
    ? 1536
    : env.OPENAI_EMBEDDING_MODEL === 'text-embedding-3-large'
      ? 3072
      : undefined;

export const normalizePineconeMetadata = (
  metadata: Record<string, unknown>
): PineconeMetadata => {
  const normalized: PineconeMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    const stringValue = getString(value);
    const numberValue = getNumber(value);
    const booleanValue = getBoolean(value);
    const stringArrayValue = getStringArray(value);

    if (stringValue !== undefined) {
      normalized[key] = stringValue;
    } else if (numberValue !== undefined) {
      normalized[key] = numberValue;
    } else if (booleanValue !== undefined) {
      normalized[key] = booleanValue;
    } else if (stringArrayValue !== undefined) {
      normalized[key] = stringArrayValue;
    }
  }

  return normalized;
};

const buildPineconeFilter = (filters: VectorSearchFilters = {}): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};

  if (filters.jurisdiction) filter.jurisdiction = { $eq: filters.jurisdiction };
  if (filters.topic) filter.topic = { $eq: filters.topic };
  if (filters.sourceCategory) filter.sourceCategory = { $eq: filters.sourceCategory };
  if (filters.adminCategory) filter.adminCategory = { $eq: filters.adminCategory };
  if (filters.status) filter.status = { $eq: filters.status };
  if (typeof filters.legalReviewed === 'boolean') {
    filter.legalReviewed = { $eq: filters.legalReviewed };
  }
  if (filters.sourceIds?.length) {
    filter.sourceId = { $in: filters.sourceIds };
  }
  if (filters.legislationTags?.length) {
    filter.legislationTags = { $in: filters.legislationTags };
  }

  return filter;
};

const getChunkMetadataString = (
  metadata: Record<string, unknown> | undefined,
  key: string
): string => (typeof metadata?.[key] === 'string' ? metadata[key] : '');

const isPineconeNotFoundError = (error: unknown): boolean => {
  const errorLike = error as {
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    cause?: {
      status?: number;
      statusCode?: number;
    };
  };

  return (
    errorLike?.name === 'PineconeNotFoundError' ||
    errorLike?.status === StatusCodes.NOT_FOUND ||
    errorLike?.statusCode === StatusCodes.NOT_FOUND ||
    errorLike?.cause?.status === StatusCodes.NOT_FOUND ||
    errorLike?.cause?.statusCode === StatusCodes.NOT_FOUND ||
    /HTTP status 404/i.test(errorLike?.message ?? '')
  );
};

export class PineconeVectorStore implements VectorStore {
  private client?: Pinecone;

  private getIndex() {
    if (!env.PINECONE_API_KEY) {
      throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Pinecone is not configured');
    }

    this.client ??= new Pinecone({ apiKey: env.PINECONE_API_KEY });

    return this.client.index(env.PINECONE_INDEX_NAME).namespace(env.PINECONE_NAMESPACE);
  }

  async upsertChunks(params: VectorStoreUpsertParams): Promise<void> {
    if (!params.chunks.length) {
      return;
    }

    const index = this.getIndex();
    const vectors = params.chunks.map((chunk: VectorChunkUpsertRecord) => ({
      id: chunk.id,
      values: chunk.values,
      metadata: normalizePineconeMetadata(chunk.metadata)
    }));

    await index.upsert({ records: vectors });
    logger.info(
      {
        count: vectors.length,
        indexName: env.PINECONE_INDEX_NAME,
        namespace: env.PINECONE_NAMESPACE
      },
      'Pinecone chunks upserted'
    );
  }

  async search(params: VectorStoreSearchParams): Promise<VectorSearchResult[]> {
    const index = this.getIndex();
    const response = await index.query({
      vector: params.vector,
      topK: params.topK,
      includeMetadata: true,
      filter: buildPineconeFilter(params.filters)
    });

    return (response.matches ?? [])
      .map((match) => {
        const metadata = (match.metadata ?? {}) as Record<string, unknown>;
        const chunkId = getChunkMetadataString(metadata, 'chunkId');
        const sourceId = getChunkMetadataString(metadata, 'sourceId');

        if (!chunkId || !sourceId) {
          return null;
        }

        return {
          chunkId,
          sourceId,
          score: match.score ?? 0,
          metadata
        };
      })
      .filter((item): item is VectorSearchResult => Boolean(item));
  }

  async deleteBySource(sourceId: string): Promise<void> {
    const index = this.getIndex();

    try {
      await index.deleteMany({ filter: { sourceId: { $eq: sourceId } } });
      logger.info({ sourceId }, 'Pinecone vectors deleted by source');
    } catch (error) {
      if (isPineconeNotFoundError(error)) {
        logger.info({ sourceId }, 'Pinecone source delete skipped because no vectors were found');
        return;
      }

      throw error;
    }
  }

  async deleteByChunkIds(chunkIds: string[]): Promise<void> {
    if (!chunkIds.length) {
      return;
    }

    const index = this.getIndex();

    try {
      await index.deleteMany({ filter: { chunkId: { $in: chunkIds } } });
      logger.info({ count: chunkIds.length }, 'Pinecone vectors deleted by chunk ids');
    } catch (error) {
      if (isPineconeNotFoundError(error)) {
        logger.info(
          { count: chunkIds.length },
          'Pinecone chunk delete skipped because no vectors were found'
        );
        return;
      }

      throw error;
    }
  }

  async healthCheck(): Promise<VectorStoreHealth> {
    if (!env.PINECONE_API_KEY) {
      return {
        configured: false,
        healthy: false,
        indexName: env.PINECONE_INDEX_NAME,
        namespace: env.PINECONE_NAMESPACE,
        embeddingModel: env.OPENAI_EMBEDDING_MODEL,
        expectedDimension: getExpectedEmbeddingDimension(),
        reachable: false,
        message: 'PINECONE_API_KEY is not configured'
      };
    }

    try {
      await this.getIndex().describeIndexStats();

      return {
        configured: true,
        healthy: true,
        indexName: env.PINECONE_INDEX_NAME,
        namespace: env.PINECONE_NAMESPACE,
        embeddingModel: env.OPENAI_EMBEDDING_MODEL,
        expectedDimension: getExpectedEmbeddingDimension(),
        reachable: true
      };
    } catch (error) {
      return {
        configured: true,
        healthy: false,
        indexName: env.PINECONE_INDEX_NAME,
        namespace: env.PINECONE_NAMESPACE,
        embeddingModel: env.OPENAI_EMBEDDING_MODEL,
        expectedDimension: getExpectedEmbeddingDimension(),
        reachable: false,
        message: error instanceof Error ? error.message : 'Pinecone health check failed'
      };
    }
  }
}

export const pineconeVectorStore = new PineconeVectorStore();
