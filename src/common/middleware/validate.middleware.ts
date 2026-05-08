import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { ZodType } from 'zod';
import { ZodError } from 'zod';

import { ApiError } from '@common/errors/ApiError';

interface ValidationSchemas {
  body?: ZodType<unknown>;
  query?: ZodType<unknown>;
  params?: ZodType<unknown>;
}

export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as Request['query'];
      }

      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Request['params'];
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new ApiError(
            StatusCodes.BAD_REQUEST,
            'Validation failed',
            error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
              code: issue.code
            }))
          )
        );
        return;
      }

      next(error);
    }
  };
};
