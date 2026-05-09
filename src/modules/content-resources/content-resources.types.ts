import type { CONTENT_RESOURCE_STATUSES } from './content-resources.constants';

export type ContentResourceStatus = (typeof CONTENT_RESOURCE_STATUSES)[number];

export interface ContentResourceServiceContext {
  actor?: {
    userId?: string;
  };
  ip?: string;
  userAgent?: string;
}
