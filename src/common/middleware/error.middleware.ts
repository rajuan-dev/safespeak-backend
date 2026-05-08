import type { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';

import { env } from '@config/env';
import { ApiError } from '@common/errors/ApiError';
import { logger } from '@common/utils/logger';

export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next) => {
  let statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
  let message = 'Internal server error';
  let errors: unknown[] = [];

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
    message = error.message;
    errors = error.errors;
  } else if (error instanceof ZodError) {
    statusCode = StatusCodes.BAD_REQUEST;
    message = 'Validation failed';
    errors = error.issues;
  } else if (error instanceof Error) {
    message = env.NODE_ENV === 'production' ? message : error.message;
  }

  logger.error(
    {
      error,
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode
    },
    message
  );

  res.status(statusCode).json({
    success: false,
    message,
    requestId: req.requestId,
    errors
  });
};
