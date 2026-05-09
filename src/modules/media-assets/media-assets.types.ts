import type { MEDIA_ASSET_STATUSES } from './media-assets.constants';

export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

export interface MediaAssetServiceContext {
  actor?: {
    userId?: string;
  };
  ip?: string;
  userAgent?: string;
}
