import { Schema, model, type Types } from 'mongoose';

import { MICRO_EDUCATION_CATEGORY_STATUSES } from './microeducation.constants';
import type { MicroEducationCategoryStatus } from './microeducation.types';

export interface MicroEducationCategoryDocument {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  backgroundColor: string;
  textColor: string;
  iconName?: string;
  imageUrl?: string;
  status: MicroEducationCategoryStatus;
  sortOrder: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const microEducationCategorySchema = new Schema<MicroEducationCategoryDocument>(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: false, trim: true },
    backgroundColor: { type: String, required: true, trim: true, default: '#01579B' },
    textColor: { type: String, required: true, trim: true, default: '#FFFFFF' },
    iconName: { type: String, required: false, trim: true },
    imageUrl: { type: String, required: false, trim: true },
    status: {
      type: String,
      enum: MICRO_EDUCATION_CATEGORY_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    sortOrder: { type: Number, required: true, default: 0, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    deletedAt: { type: Date, required: false, index: true }
  },
  { timestamps: true }
);

microEducationCategorySchema.index(
  { name: 1, deletedAt: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $exists: false } } }
);
microEducationCategorySchema.index({ status: 1, sortOrder: 1, name: 1 });

export const MicroEducationCategoryModel = model<MicroEducationCategoryDocument>(
  'MicroEducationCategory',
  microEducationCategorySchema
);
