import { Schema, model, type Types } from 'mongoose';

import { CONTENT_RESOURCE_STATUSES } from './content-resources.constants';
import type { ContentResourceStatus } from './content-resources.types';

export interface ContentResourceDocument {
  _id: Types.ObjectId;
  name: string;
  language: string;
  category: string;
  jurisdiction: string;
  reviewDate?: Date;
  status: ContentResourceStatus;
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

const contentResourceSchema = new Schema<ContentResourceDocument>(
  {
    name: { type: String, required: true, trim: true, index: true },
    language: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    jurisdiction: { type: String, required: true, trim: true, index: true },
    reviewDate: { type: Date, required: false, index: true },
    status: {
      type: String,
      enum: CONTENT_RESOURCE_STATUSES,
      default: 'published',
      required: true,
      index: true
    },
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

contentResourceSchema.index({ status: 1, category: 1, reviewDate: 1, createdAt: -1 });

export const ContentResourceModel = model<ContentResourceDocument>(
  'ContentResource',
  contentResourceSchema
);
