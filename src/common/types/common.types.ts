export interface ApiMeta {
  [key: string]: unknown;
}

export interface ApiResponse<TData = unknown> {
  success: boolean;
  message: string;
  data?: TData;
  meta?: ApiMeta;
  errors?: unknown[];
}
