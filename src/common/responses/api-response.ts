import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import type {
  ApiMeta,
  ApiResponse as ApiResponseBody,
  PaginationMeta
} from '@common/types/common.types';

export class ApiResponse {
  static successBody<TData>(
    message: string,
    data: TData | null = null,
    meta: ApiMeta | null = null
  ): ApiResponseBody<TData> {
    return {
      success: true,
      message,
      data,
      meta,
      timestamp: new Date().toISOString()
    };
  }

  static success<TData>(
    res: Response,
    message: string,
    data: TData | null = null,
    meta: ApiMeta | null = null,
    statusCode = StatusCodes.OK
  ): Response<ApiResponseBody<TData>> {
    return res.status(statusCode).json(this.successBody(message, data, meta)) as Response<
      ApiResponseBody<TData>
    >;
  }

  static created<TData>(
    res: Response,
    message: string,
    data: TData | null = null,
    meta: ApiMeta | null = null
  ): Response<ApiResponseBody<TData>> {
    return this.success(res, message, data, meta, StatusCodes.CREATED);
  }

  static paginated<TData>(
    res: Response,
    message: string,
    data: TData,
    pagination: PaginationMeta
  ): Response<ApiResponseBody<TData>> {
    return this.success(res, message, data, pagination);
  }

  static noContent(res: Response): Response {
    return res.status(StatusCodes.NO_CONTENT).send();
  }

  static error(
    message: string,
    options: {
      errors?: unknown[];
      errorCode?: string;
      requestId?: string;
    } = {}
  ): ApiResponseBody<null> {
    return {
      success: false,
      message,
      data: null,
      meta: null,
      errors: options.errors?.length ? options.errors : undefined,
      errorCode: options.errorCode,
      requestId: options.requestId,
      timestamp: new Date().toISOString()
    };
  }
}

export const successResponse = <TData>(
  message: string,
  data: TData | null = null,
  meta: ApiMeta | null = null
): ApiResponseBody<TData> => ApiResponse.successBody(message, data, meta);

export const errorResponse = (
  message: string,
  errors: unknown[] = [],
  meta: ApiMeta | null = null
): ApiResponseBody<null> => ({
  ...ApiResponse.error(message, { errors }),
  meta
});
