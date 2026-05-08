import { Schema, model, type Types } from 'mongoose';

import { AI_REVIEW_STATUSES } from './ai.constants';
import type { AiAction, AiCitation, AiGuardrailResult, AiReviewStatus } from './ai.types';

export interface AiInteractionDocument {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  reportId?: Types.ObjectId;
  action: AiAction;
  model: string;
  language: string;
  inputHash: string;
  output: Record<string, unknown>;
  citations: AiCitation[];
  guardrails: AiGuardrailResult;
  reviewStatus: AiReviewStatus;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const aiInteractionSchema = new Schema<AiInteractionDocument>(
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
    reportId: {
      type: Schema.Types.ObjectId,
      ref: 'Report',
      required: false,
      index: true
    },
    action: {
      type: String,
      required: true,
      index: true
    },
    model: {
      type: String,
      required: true
    },
    language: {
      type: String,
      required: true,
      default: 'en'
    },
    inputHash: {
      type: String,
      required: true,
      index: true
    },
    output: {
      type: Schema.Types.Mixed,
      required: true
    },
    citations: {
      type: [Object],
      default: []
    },
    guardrails: {
      type: Schema.Types.Mixed,
      required: true
    },
    reviewStatus: {
      type: String,
      enum: AI_REVIEW_STATUSES,
      required: true,
      default: 'pending_human_review',
      index: true
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    reviewedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true
  }
);

aiInteractionSchema.index({ userId: 1, createdAt: -1 });
aiInteractionSchema.index({ sessionId: 1, createdAt: -1 });

export const AiInteractionModel = model<AiInteractionDocument>(
  'AiInteraction',
  aiInteractionSchema
);
