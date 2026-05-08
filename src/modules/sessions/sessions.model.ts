import { Schema, model } from 'mongoose';
import type { Types } from 'mongoose';

import { DEFAULT_SESSION_JURISDICTION, DEFAULT_SESSION_LANGUAGE } from './sessions.constants';

export interface AnonymousSessionDocument {
  sessionTokenHash: string;
  userId?: Types.ObjectId;
  isAnonymous: boolean;
  safetyGateAcceptedAt?: Date;
  language: string;
  jurisdiction: string;
  lga?: string;
  consentSnapshot?: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const anonymousSessionSchema = new Schema<AnonymousSessionDocument>(
  {
    sessionTokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    isAnonymous: {
      type: Boolean,
      default: true,
      required: true
    },
    safetyGateAcceptedAt: {
      type: Date,
      required: false
    },
    language: {
      type: String,
      default: DEFAULT_SESSION_LANGUAGE
    },
    jurisdiction: {
      type: String,
      default: DEFAULT_SESSION_JURISDICTION
    },
    lga: {
      type: String,
      required: false
    },
    consentSnapshot: {
      type: Schema.Types.Mixed,
      default: {}
    },
    expiresAt: {
      type: Date,
      required: true,
      index: {
        expires: 0
      }
    }
  },
  {
    timestamps: true
  }
);

export const AnonymousSessionModel = model<AnonymousSessionDocument>(
  'AnonymousSession',
  anonymousSessionSchema
);
