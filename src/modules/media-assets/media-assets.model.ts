import { Schema, model, type Types } from 'mongoose';

import { MEDIA_ASSET_STATUSES } from './media-assets.constants';
import type { MediaAssetStatus } from './media-assets.types';

export interface MediaAssetDocument {
  _id: Types.ObjectId;
  title: string;
  subtitle: string;
  bodyText: string;
  category: string;
  status: MediaAssetStatus;
  createdDate?: Date;
  expirationDate?: Date;
  offlineCachingEnabled: boolean;
  primaryCta?: string;
  secondaryButton?: string;
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const mediaAssetSchema = new Schema<MediaAssetDocument>(
  {
    title: { type: String, required: true, trim: true, index: true },
    subtitle: { type: String, required: true, trim: true },
    bodyText: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: MEDIA_ASSET_STATUSES,
      default: 'published',
      required: true,
      index: true
    },
    createdDate: { type: Date, required: false },
    expirationDate: { type: Date, required: false },
    offlineCachingEnabled: { type: Boolean, default: false, required: true },
    primaryCta: { type: String, required: false, trim: true },
    secondaryButton: { type: String, required: false, trim: true },
    originalFileName: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true, trim: true },
    fileSizeBytes: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    deletedAt: { type: Date, required: false, index: true }
  },
  { timestamps: true }
);

mediaAssetSchema.index({ status: 1, category: 1, createdAt: -1 });

export const MediaAssetModel = model<MediaAssetDocument>('MediaAsset', mediaAssetSchema);
