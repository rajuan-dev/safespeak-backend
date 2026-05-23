import { Schema, model, type Types } from 'mongoose';

import { FEEDBACK_SOURCES, FEEDBACK_STATUSES } from './feedback.constants';
import type { FeedbackSource, FeedbackStatus } from './feedback.types';

export interface FeedbackDocument {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message: string;
  rating?: number;
  source: FeedbackSource;
  status: FeedbackStatus;
  adminNotes?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const feedbackSchema = new Schema<FeedbackDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'AnonymousSession',
      required: false,
      index: true
    },
    name: {
      type: String,
      required: false,
      trim: true
    },
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: false,
      trim: true
    },
    subject: {
      type: String,
      required: false,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    rating: {
      type: Number,
      required: false,
      min: 1,
      max: 5
    },
    source: {
      type: String,
      enum: FEEDBACK_SOURCES,
      required: true,
      default: 'user_feedback',
      index: true
    },
    status: {
      type: String,
      enum: FEEDBACK_STATUSES,
      required: true,
      default: 'new',
      index: true
    },
    adminNotes: {
      type: String,
      required: false,
      trim: true
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    reviewedAt: {
      type: Date,
      required: false
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ source: 1, createdAt: -1 });
feedbackSchema.index({ name: 'text', email: 'text', subject: 'text', message: 'text' });

export const FeedbackModel = model<FeedbackDocument>('Feedback', feedbackSchema);
