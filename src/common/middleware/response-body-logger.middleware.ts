import type { NextFunction, Request, Response } from 'express';

import { redactSensitive, truncateForLog } from '@common/utils/sanitize';

const JSON_RESPONSE_LOG_LIMIT = 10_000;

const isJsonContentType = (value: number | string | string[] | undefined): boolean => {
  if (!value) {
    return false;
  }

  return String(Array.isArray(value) ? value.join(';') : value).includes('application/json');
};

const parseJsonSafe = (body: unknown): unknown => {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

export const responseBodyLoggerMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (body: unknown): Response => {
    res.locals.responseBody = truncateForLog(redactSensitive(body), JSON_RESPONSE_LOG_LIMIT);

    return originalJson(body);
  };

  res.send = (body?: unknown): Response => {
    if (isJsonContentType(res.getHeader('content-type'))) {
      const parsedBody = parseJsonSafe(body);

      if (parsedBody !== undefined) {
        res.locals.responseBody = truncateForLog(
          redactSensitive(parsedBody),
          JSON_RESPONSE_LOG_LIMIT
        );
      }
    }

    return originalSend(body);
  };

  next();
};
