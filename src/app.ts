import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import passport from 'passport';
import swaggerUi from 'swagger-ui-express';

import { corsOptions } from '@config/cors';
import { appConstants } from '@config/constants';
import { helmetMiddleware, oauthRateLimiter, rateLimiter } from '@config/security';
import { errorMiddleware } from '@common/middleware/error.middleware';
import { notFoundMiddleware } from '@common/middleware/not-found.middleware';
import { requestIdMiddleware } from '@common/middleware/request-id.middleware';
import { requestLoggerMiddleware } from '@common/middleware/request-logger.middleware';
import { responseBodyLoggerMiddleware } from '@common/middleware/response-body-logger.middleware';
import { configurePassport } from '@modules/auth/auth.passport';
import { googleAuthRoutes } from '@modules/auth/auth.routes';
import { healthRoutes } from '@modules/health/health.routes';
import { apiRouter } from '@routes/index';

import { openApiDocument } from './docs/openapi';

export const createApp = (): express.Application => {
  const app = express();
  configurePassport();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestIdMiddleware);
  app.use(responseBodyLoggerMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(helmetMiddleware);
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ type: 'application/json', limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(rateLimiter);
  app.use(passport.initialize());

  app.use('/health', healthRoutes);
  app.use('/api/auth/google', oauthRateLimiter);
  app.use('/api/auth', googleAuthRoutes);
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { explorer: true }));
  app.get(`${appConstants.apiPrefix}/openapi.json`, (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(
    `${appConstants.apiPrefix}/docs`,
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { explorer: true })
  );
  app.use(appConstants.apiPrefix, apiRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
