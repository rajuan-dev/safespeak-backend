import type { RESOURCE_STATUSES } from './resources.constants';

export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export interface ResourceServiceContext {
  actor?: {
    userId?: string;
  };
  ip?: string;
  userAgent?: string;
}
