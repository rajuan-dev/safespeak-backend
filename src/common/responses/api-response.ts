import type { ApiMeta, ApiResponse } from '@common/types/common.types';

export const successResponse = <TData>(
  message: string,
  data: TData,
  meta: ApiMeta = {}
): ApiResponse<TData> => ({
  success: true,
  message,
  data,
  meta
});

export const errorResponse = (
  message: string,
  errors: unknown[] = [],
  meta: ApiMeta = {}
): ApiResponse => ({
  success: false,
  message,
  errors,
  meta
});
