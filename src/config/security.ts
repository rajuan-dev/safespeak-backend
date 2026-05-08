import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { StatusCodes } from 'http-status-codes';

import { env } from './env';

export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: {
    policy: 'cross-origin'
  }
});

export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    errors: []
  },
  statusCode: StatusCodes.TOO_MANY_REQUESTS
});
