import type { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';

import { env } from '@config/env';
import { ApiError } from '@common/errors/ApiError';
import { ApiResponse } from '@common/responses/api-response';
import { logger } from '@common/utils/logger';
import { redactSensitive } from '@common/utils/sanitize';

const BAD_REQUEST_STATUS: number = StatusCodes.BAD_REQUEST;
const UNAUTHORIZED_STATUS: number = StatusCodes.UNAUTHORIZED;
const FORBIDDEN_STATUS: number = StatusCodes.FORBIDDEN;
const NOT_FOUND_STATUS: number = StatusCodes.NOT_FOUND;

const getErrorCategory = (error: unknown, statusCode: number): string => {
  if (error instanceof ZodError || statusCode === BAD_REQUEST_STATUS) {
    return 'validation';
  }

  if (statusCode === UNAUTHORIZED_STATUS || statusCode === FORBIDDEN_STATUS) {
    return 'auth';
  }

  if (
    error instanceof Error &&
    ['MongoError', 'MongoServerError', 'MongooseError', 'ValidationError', 'CastError'].includes(
      error.name
    )
  ) {
    return 'database';
  }

  return 'unknown';
};

const getErrorCode = (category: string, statusCode: number): string => {
  if (category === 'validation') {
    return 'VALIDATION_ERROR';
  }

  if (category === 'auth') {
    return 'AUTH_ERROR';
  }

  if (statusCode === NOT_FOUND_STATUS) {
    return 'NOT_FOUND';
  }

  if (category === 'database') {
    return 'DATABASE_ERROR';
  }

  return 'INTERNAL_ERROR';
};

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

  const errorCategory = getErrorCategory(error, statusCode);
  const errorCode = getErrorCode(errorCategory, statusCode);

  logger.error(
    {
      error,
      errorCategory,
      errorCode,
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      body: redactSensitive(req.body),
      query: redactSensitive(req.query),
      params: redactSensitive(req.params)
    },
    message
  );

  res.status(statusCode).json(
    ApiResponse.error(message, {
      errors,
      errorCode,
      requestId: req.requestId
    })
  );
};
