import { Schema, model, type Types } from 'mongoose';

import type { PasswordResetAudience } from './auth.schema';

export interface PasswordResetRequestDocument {
  userId: Types.ObjectId;
  email: string;
  audience: PasswordResetAudience;
  otpHash: string;
  otpNonce: string;
  otpAttempts: number;
  maxOtpAttempts: number;
  resetTokenHash?: string;
  resetTokenNonce?: string;
  resetTokenExpiresAt?: Date;
  verifiedAt?: Date;
  usedAt?: Date;
  expiresAt: Date;
  deliveredAt?: Date;
  deliveryMode?: 'webhook' | 'development_outbox';
  deliveryReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetRequestSchema = new Schema<PasswordResetRequestDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    audience: {
      type: String,
      enum: ['admin', 'public'],
      required: true,
      default: 'admin',
      index: true
    },
    otpHash: {
      type: String,
      required: true,
      select: false
    },
    otpNonce: {
      type: String,
      required: true,
      select: false
    },
    otpAttempts: {
      type: Number,
      default: 0,
      required: true
    },
    maxOtpAttempts: {
      type: Number,
      default: 5,
      required: true
    },
    resetTokenHash: {
      type: String,
      required: false,
      select: false
    },
    resetTokenNonce: {
      type: String,
      required: false,
      select: false
    },
    resetTokenExpiresAt: {
      type: Date,
      required: false
    },
    verifiedAt: {
      type: Date,
      required: false
    },
    usedAt: {
      type: Date,
      required: false,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    deliveredAt: {
      type: Date,
      required: false
    },
    deliveryMode: {
      type: String,
      enum: ['webhook', 'development_outbox'],
      required: false
    },
    deliveryReference: {
      type: String,
      required: false,
      trim: true
    }
  },
  { timestamps: true }
);

passwordResetRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
passwordResetRequestSchema.index({ email: 1, audience: 1, createdAt: -1 });
passwordResetRequestSchema.index({ userId: 1, usedAt: 1, expiresAt: 1 });

export const PasswordResetRequestModel = model<PasswordResetRequestDocument>(
  'PasswordResetRequest',
  passwordResetRequestSchema
);
