import http from 'node:http';

import { createApp } from './app';
import { bootstrapApp } from './bootstrap';
import { logger } from './common/utils/logger';
import { disconnectDatabase } from './config/database';
import { env } from './config/env';

const app = createApp();
const server = http.createServer(app);

const handleListenError = (error: NodeJS.ErrnoException): void => {
  if (error.code === 'EADDRINUSE') {
    logger.fatal(
      {
        port: env.PORT,
        error
      },
      'HTTP server failed to start because the port is already in use. Stop the existing process or set PORT to a different value.'
    );

    process.exit(1);
  }

  logger.fatal({ error }, 'HTTP server failed to start');
  process.exit(1);
};

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'Graceful shutdown started');

  server.close(() => {
    void disconnectDatabase()
      .then(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'Graceful shutdown failed');
        process.exit(1);
      });
  });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});

const bootstrap = async (): Promise<void> => {
  await bootstrapApp();

  server.once('error', handleListenError);

  server.listen(env.PORT, () => {
    server.off('error', handleListenError);

    logger.info(
      {
        port: env.PORT,
        environment: env.NODE_ENV,
        apiPrefix: env.API_PREFIX,
        pineconeIndexName: env.PINECONE_INDEX_NAME,
        pineconeNamespace: env.PINECONE_NAMESPACE
      },
      'SafeSpeak backend started'
    );

    if (!env.PINECONE_API_KEY) {
      logger.warn(
        {
          indexName: env.PINECONE_INDEX_NAME,
          namespace: env.PINECONE_NAMESPACE
        },
        'Pinecone is disabled because PINECONE_API_KEY is missing; Mongo RAG fallback remains available'
      );
    }
  });
};

void bootstrap();
