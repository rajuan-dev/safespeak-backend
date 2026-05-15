import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { StatusCodes } from 'http-status-codes';

import { env } from './env';

export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: {
    policy: 'cross-origin'
  }
});

const effectiveRateLimitMax =
  env.NODE_ENV === 'production' ? env.RATE_LIMIT_MAX : Math.max(env.RATE_LIMIT_MAX, 3000);

export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: effectiveRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/api/auth/google' || req.path === '/api/auth/google/callback',
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    errors: []
  },
  statusCode: StatusCodes.TOO_MANY_REQUESTS
});

export const oauthRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: env.NODE_ENV === 'production' ? 30 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many OAuth requests. Please try again later.',
    errors: []
  },
  statusCode: StatusCodes.TOO_MANY_REQUESTS
});
