import pino from 'pino';

import { env } from '@config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.authorization',
      '*.cookie',
      '*.otp',
      '*.secret',
      'body.password',
      'body.token',
      'body.accessToken',
      'body.refreshToken',
      'body.authorization',
      'body.cookie',
      'body.otp',
      'body.secret',
      'responseBody.data.accessToken',
      'responseBody.data.refreshToken'
    ],
    censor: '[REDACTED]'
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard'
          }
        }
      : undefined
});
