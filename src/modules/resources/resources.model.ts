import { Schema, model, type Types } from 'mongoose';

import { RESOURCE_STATUSES } from './resources.constants';
import type { ResourceStatus } from './resources.types';

export interface ResourceDocument {
  _id: Types.ObjectId;
  name: string;
  category: string;
  region: string;
  contact: string;
  status: ResourceStatus;
  sortOrder: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const resourceSchema = new Schema<ResourceDocument>(
  {
    name: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    region: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    status: { type: String, enum: RESOURCE_STATUSES, default: 'published', required: true, index: true },
    sortOrder: { type: Number, default: 0, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    deletedAt: { type: Date, required: false, index: true }
  },
  { timestamps: true }
);

resourceSchema.index({ status: 1, sortOrder: 1, createdAt: -1 });

export const ResourceModel = model<ResourceDocument>('Resource', resourceSchema);
