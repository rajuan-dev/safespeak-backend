import type { PipelineStage } from 'mongoose';

import { logger } from '@common/utils/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { env } from '@config/env';
import { RagChunkModel } from '@modules/rag/rag.model';

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072
};

const run = async (): Promise<void> => {
  await connectDatabase();

  try {
    const expectedDimensions = EMBEDDING_DIMENSIONS[env.OPENAI_EMBEDDING_MODEL];
    const pipeline = [{ $listSearchIndexes: {} }] as unknown as PipelineStage[];
    type SearchIndexResult = { name?: string; latestDefinition?: unknown };
    const indexes = await RagChunkModel.aggregate<SearchIndexResult>(pipeline);
    const target = indexes.find((index) => index.name === env.RAG_VECTOR_INDEX);

    if (!target) {
      logger.error(
        {
          collection: RagChunkModel.collection.name,
          indexName: env.RAG_VECTOR_INDEX,
          embeddingField: 'embedding',
          expectedDimensions
        },
        'RAG vector index is missing. Create the Atlas Search index manually before retrieval tests.'
      );
      process.exitCode = 1;
      return;
    }

    logger.info(
      {
        collection: RagChunkModel.collection.name,
        indexName: env.RAG_VECTOR_INDEX,
        embeddingField: 'embedding',
        expectedDimensions,
        definition: target.latestDefinition ?? null
      },
      'RAG vector index is available'
    );
  } catch (error) {
    const errorLike = error as { message?: string; codeName?: string; errorResponse?: { errmsg?: string; codeName?: string } };
    const message
      = errorLike?.message
        ?? errorLike?.errorResponse?.errmsg
        ?? errorLike?.codeName
        ?? errorLike?.errorResponse?.codeName
        ?? String(error);
    const codeName = errorLike?.codeName ?? errorLike?.errorResponse?.codeName ?? '';

    if (/SearchNotEnabled/i.test(`${codeName} ${message}`)) {
      logger.error(
        {
          collection: RagChunkModel.collection.name,
          indexName: env.RAG_VECTOR_INDEX,
          embeddingField: 'embedding',
          expectedDimensions: EMBEDDING_DIMENSIONS[env.OPENAI_EMBEDDING_MODEL]
        },
        'Atlas Search / Vector Search is not enabled on this Mongo deployment. Enable Atlas Search, then create the index described in docs/mongodb-vector-search-setup.md.'
      );
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await disconnectDatabase();
  }
};

void run().catch((error: unknown) => {
  logger.error({ error }, 'rag:check:index failed');
  process.exit(1);
});
