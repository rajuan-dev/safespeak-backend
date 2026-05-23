import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

import { CONTENT_PAGE_KEYS } from './content-pages.constants';
import type { ContentPageContent, ContentPageKey } from './content-pages.types';

export interface ContentPageDocument {
  _id: Types.ObjectId;
  key: ContentPageKey;
  draft: ContentPageContent;
  published: ContentPageContent;
  version: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ContentPageHydratedDocument = HydratedDocument<ContentPageDocument>;

const contentPageSchema = new Schema<ContentPageDocument>(
  {
    key: {
      type: String,
      enum: CONTENT_PAGE_KEYS,
      required: true,
      unique: true,
      index: true
    },
    draft: {
      type: Schema.Types.Mixed,
      required: true
    },
    published: {
      type: Schema.Types.Mixed,
      required: true
    },
    version: { type: Number, default: 1, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    publishedAt: { type: Date, required: false }
  },
  { timestamps: true }
);

export const ContentPageModel = model<ContentPageDocument>('ContentPage', contentPageSchema);
