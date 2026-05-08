export interface ApiMeta {
  [key: string]: unknown;
}

export interface ApiResponse<TData = unknown> {
  success: boolean;
  message: string;
  data: TData | null;
  meta: ApiMeta | null;
  errors?: unknown[];
  errorCode?: string;
  requestId?: string;
  timestamp: string;
}

export interface PaginationMeta extends ApiMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  query?: string;
  filters?: Record<string, unknown>;
}
