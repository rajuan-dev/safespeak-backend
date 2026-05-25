import { logger } from '@common/utils/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { checkRagVectorIndexReadiness } from '@modules/rag/rag.service';

const run = async (): Promise<void> => {
  await connectDatabase();

  try {
    const readiness = await checkRagVectorIndexReadiness();
    const logPayload = {
      collection: readiness.collectionName,
      indexName: readiness.indexName,
      embeddingField: readiness.embeddingField,
      embeddingModel: readiness.embeddingModel,
      expectedDimensions: readiness.expectedDimensions,
      definition: readiness.definition ?? null
    };

    if (readiness.status === 'ready') {
      logger.info(logPayload, readiness.message);
      return;
    }

    logger.error(logPayload, readiness.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
};

void run().catch((error: unknown) => {
  logger.error({ error }, 'rag:check:index failed');
  process.exit(1);
});
