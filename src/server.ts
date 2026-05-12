import http from 'node:http';

import { createApp } from './app';
import { bootstrapApp } from './bootstrap';
import { logger } from './common/utils/logger';
import { disconnectDatabase } from './config/database';
import { env } from './config/env';

const app = createApp();
const server = http.createServer(app);

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

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        environment: env.NODE_ENV,
        apiPrefix: env.API_PREFIX
      },
      'SafeSpeak backend started'
    );
  });
};

void bootstrap();
