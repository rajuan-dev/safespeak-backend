import { Schema, model, type Types } from 'mongoose';

import {
  MICRO_EDUCATION_CHIPS,
  MICRO_EDUCATION_DURATIONS,
  MICRO_EDUCATION_FORMATS,
  MICRO_EDUCATION_IMAGE_STORAGE_PROVIDERS,
  MICRO_EDUCATION_STATUSES,
  MICRO_EDUCATION_TONES
} from './microeducation.constants';
import type {
  MicroEducationChip,
  MicroEducationDuration,
  MicroEducationFormat,
  MicroEducationImageStorageProvider,
  MicroEducationStatus,
  MicroEducationTone
} from './microeducation.types';

export interface MicroEducationDocument {
  _id: Types.ObjectId;
  title: string;
  summary: string;
  readTimeLabel: string;
  tag: string;
  cta: string;
  detailHeading: string;
  detailSummary?: string;
  detailBody: string;
  detailTakeaway: string;
  imageAlt?: string;
  tone: MicroEducationTone;
  chips: MicroEducationChip[];
  duration: MicroEducationDuration;
  format: MicroEducationFormat;
  status: MicroEducationStatus;
  sortOrder: number;
  views: number;
  imageStorageProvider?: MicroEducationImageStorageProvider;
  imageOriginalFileName?: string;
  imageStorageKey?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  imageS3Bucket?: string;
  imageS3Region?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const microEducationSchema = new Schema<MicroEducationDocument>(
  {
    title: { type: String, required: true, trim: true, index: true },
    summary: { type: String, required: true, trim: true },
    readTimeLabel: { type: String, required: true, trim: true, default: '4 min read' },
    tag: { type: String, required: true, trim: true },
    cta: { type: String, required: true, trim: true },
    detailHeading: { type: String, required: true, trim: true, default: 'Safety overview' },
    detailSummary: { type: String, required: false, trim: true },
    detailBody: { type: String, required: true, trim: true, default: 'Review the guidance and choose the next safe step that fits your situation.' },
    detailTakeaway: { type: String, required: true, trim: true, default: 'Keep notes simple, factual, and stored somewhere safe.' },
    imageAlt: { type: String, required: false, trim: true },
    tone: { type: String, enum: MICRO_EDUCATION_TONES, required: true, default: 'blue' },
    chips: { type: [String], enum: MICRO_EDUCATION_CHIPS, required: true, default: ['safety'] },
    duration: {
      type: String,
      enum: MICRO_EDUCATION_DURATIONS,
      required: true,
      default: 'quick',
      index: true
    },
    format: {
      type: String,
      enum: MICRO_EDUCATION_FORMATS,
      required: true,
      default: 'guide',
      index: true
    },
    status: {
      type: String,
      enum: MICRO_EDUCATION_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    sortOrder: { type: Number, required: true, default: 0, index: true },
    views: { type: Number, required: true, default: 0, min: 0 },
    imageStorageProvider: {
      type: String,
      enum: MICRO_EDUCATION_IMAGE_STORAGE_PROVIDERS,
      required: false,
      default: 'local',
      index: true
    },
    imageOriginalFileName: { type: String, required: false, trim: true },
    imageStorageKey: { type: String, required: false, unique: true, sparse: true },
    imageMimeType: { type: String, required: false, trim: true },
    imageSizeBytes: { type: Number, required: false, min: 0 },
    imageS3Bucket: { type: String, required: false, trim: true },
    imageS3Region: { type: String, required: false, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    deletedAt: { type: Date, required: false, index: true }
  },
  { timestamps: true }
);

microEducationSchema.index({ status: 1, sortOrder: 1, createdAt: -1 });

export const MicroEducationModel = model<MicroEducationDocument>(
  'MicroEducation',
  microEducationSchema
);
