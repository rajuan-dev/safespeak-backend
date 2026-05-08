import { Schema, model } from 'mongoose';

import { DEFAULT_CONSENT_FLAGS } from './consent.constants';
import type { ConsentFlags } from './consent.types';

export interface ConsentRecordDocument {
  userId?: Schema.Types.ObjectId;
  sessionId?: Schema.Types.ObjectId;
  flags: ConsentFlags;
  version: number;
  source: string;
  ipHash?: string;
  userAgentHash?: string;
  createdAt: Date;
}

const consentRecordSchema = new Schema<ConsentRecordDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'AnonymousSession',
      required: false
    },
    flags: {
      type: Schema.Types.Mixed,
      default: DEFAULT_CONSENT_FLAGS,
      required: true
    },
    version: {
      type: Number,
      required: true
    },
    source: {
      type: String,
      required: true,
      trim: true
    },
    ipHash: {
      type: String,
      required: false
    },
    userAgentHash: {
      type: String,
      required: false
    }
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false
    }
  }
);

consentRecordSchema.index({ userId: 1, version: -1 });
consentRecordSchema.index({ sessionId: 1, version: -1 });

export const ConsentRecordModel = model<ConsentRecordDocument>(
  'ConsentRecord',
  consentRecordSchema
);
