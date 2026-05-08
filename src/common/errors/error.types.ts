export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface ErrorResponseBody {
  success: false;
  message: string;
  requestId?: string;
  errors: ErrorDetail[] | unknown[];
}
