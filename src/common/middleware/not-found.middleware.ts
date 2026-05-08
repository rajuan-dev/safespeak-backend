import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';

export const notFoundMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(StatusCodes.NOT_FOUND, `Route not found: ${req.method} ${req.originalUrl}`));
};
