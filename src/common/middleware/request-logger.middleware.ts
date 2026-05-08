import pinoHttp from 'pino-http';

import { logger } from '@common/utils/logger';

export const requestLoggerMiddleware = pinoHttp({
  logger,
  customProps: (req) => ({
    requestId: (req as typeof req & { requestId?: string }).requestId
  }),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`
});
