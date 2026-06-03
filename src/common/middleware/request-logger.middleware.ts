import type { Request, Response } from 'express';
import pinoHttp from 'pino-http';

import { isConversationMessageAppendRoute } from '@common/middleware/response-body-logger.middleware';
import { logger } from '@common/utils/logger';
import { redactSensitive, truncateForLog } from '@common/utils/sanitize';
import { env } from '@config/env';

const REQUEST_BODY_LOG_LIMIT = 10_000;

export const summarizeRequestBodyForLogging = (
  req: Pick<Request, 'method' | 'originalUrl'>,
  body: unknown,
  options?: { debugFullResponse?: boolean }
): unknown => {
  if (
    !isConversationMessageAppendRoute(req) ||
    options?.debugFullResponse === true ||
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    return body;
  }

  const payload = body as {
    content?: unknown;
    language?: unknown;
    debugResponse?: unknown;
  };

  return {
    contentPreview:
      typeof payload.content === 'string' ? payload.content.slice(0, 120) : undefined,
    language: payload.language,
    debugResponse: payload.debugResponse
  };
};

const getFileMetadata = (file?: Express.Multer.File) => {
  if (!file) {
    return undefined;
  }

  return {
    fieldname: file.fieldname,
    originalname: file.originalname,
    encoding: file.encoding,
    mimetype: file.mimetype,
    size: file.size
  };
};

const getFilesMetadata = (
  files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] }
) => {
  if (!files) {
    return undefined;
  }

  if (Array.isArray(files)) {
    return files.map(getFileMetadata);
  }

  return Object.fromEntries(
    Object.entries(files).map(([fieldname, fieldFiles]) => [
      fieldname,
      fieldFiles.map(getFileMetadata)
    ])
  );
};

const getRequestLogData = (req: Request) => ({
  requestId: req.requestId,
  method: req.method,
  url: req.originalUrl,
  ip: req.ip,
  userAgent: req.get('user-agent'),
  body: truncateForLog(
    redactSensitive(
      summarizeRequestBodyForLogging(req, req.body as unknown, {
        debugFullResponse: env.DEBUG_FULL_RESPONSE
      })
    ),
    REQUEST_BODY_LOG_LIMIT
  ),
  query: redactSensitive(req.query),
  params: redactSensitive(req.params),
  file: getFileMetadata(req.file),
  files: getFilesMetadata(req.files)
});

export const requestLoggerMiddleware = pinoHttp({
  logger,
  customProps: (req, res) => ({
    ...getRequestLogData(req as Request),
    responseBody: (res as Response).locals.responseBody as unknown
  }),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`
});
