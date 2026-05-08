import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { corsOptions } from '@config/cors';
import { appConstants } from '@config/constants';
import { helmetMiddleware, rateLimiter } from '@config/security';
import { errorMiddleware } from '@common/middleware/error.middleware';
import { notFoundMiddleware } from '@common/middleware/not-found.middleware';
import { requestIdMiddleware } from '@common/middleware/request-id.middleware';
import { requestLoggerMiddleware } from '@common/middleware/request-logger.middleware';
import { responseBodyLoggerMiddleware } from '@common/middleware/response-body-logger.middleware';
import { healthRoutes } from '@modules/health/health.routes';
import { apiRouter } from '@routes/index';

export const createApp = (): express.Application => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestIdMiddleware);
  app.use(responseBodyLoggerMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(helmetMiddleware);
  app.use(cors(corsOptions));
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(rateLimiter);

  app.use('/health', healthRoutes);
  app.use(appConstants.apiPrefix, apiRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
