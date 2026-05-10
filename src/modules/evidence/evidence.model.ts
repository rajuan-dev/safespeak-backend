import { Schema, model, type Types } from 'mongoose';

import { EVIDENCE_STATUSES, EVIDENCE_STORAGE_PROVIDERS } from './evidence.constants';
import type { EvidenceStatus, EvidenceStorageProvider } from './evidence.types';

export interface EvidenceDocument {
  _id: Types.ObjectId;
  reportId: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  ownerType: 'anonymous' | 'user';
  type: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  storageRegion: string;
  sha256Hash?: string;
  encryptionKeyRef: string;
  metadata: Record<string, unknown>;
  status: EvidenceStatus;
  storageProvider: EvidenceStorageProvider;
  localEncryptedPath?: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    iv?: string;
    authTag?: string;
  };
  s3?: {
    bucket: string;
    key: string;
    region: string;
    syncedAt: Date;
  };
  consentSnapshot: Record<string, unknown>;
  transcription?: {
    text: string;
    language?: string;
    model?: string;
    provider?: string;
    transcribedAt?: Date;
    transcribedBy?: string;
    confidence?: number;
  };
  deletionRequestedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceSchema = new Schema<EvidenceDocument>(
  {
    reportId: {
      type: Schema.Types.ObjectId,
      ref: 'Report',
      required: true,
      index: true
    },
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
    ownerType: {
      type: String,
      enum: ['anonymous', 'user'],
      required: true
    },
    type: {
      type: String,
      required: true,
      trim: true
    },
    fileName: {
      type: String,
      required: true,
      trim: true
    },
    mimeType: {
      type: String,
      required: true,
      trim: true
    },
    size: {
      type: Number,
      required: true,
      min: 0
    },
    storageKey: {
      type: String,
      required: true,
      index: true
    },
    storageRegion: {
      type: String,
      required: true
    },
    sha256Hash: {
      type: String,
      required: false,
      index: true
    },
    encryptionKeyRef: {
      type: String,
      required: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: EVIDENCE_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    storageProvider: {
      type: String,
      enum: EVIDENCE_STORAGE_PROVIDERS,
      required: true,
      default: 'local_encrypted'
    },
    localEncryptedPath: {
      type: String,
      required: false
    },
    encryption: {
      algorithm: {
        type: String,
        enum: ['aes-256-gcm'],
        required: true
      },
      iv: {
        type: String,
        required: false
      },
      authTag: {
        type: String,
        required: false
      }
    },
    s3: {
      bucket: String,
      key: String,
      region: String,
      syncedAt: Date
    },
    consentSnapshot: {
      type: Schema.Types.Mixed,
      default: {}
    },
    transcription: {
      type: new Schema(
        {
          text: { type: String, required: true },
          language: { type: String, required: false },
          model: { type: String, required: false },
          provider: { type: String, required: false },
          transcribedAt: { type: Date, required: false },
          transcribedBy: { type: String, required: false },
          confidence: { type: Number, required: false }
        },
        { _id: false, id: false }
      ),
      required: false,
      default: undefined
    },
    deletionRequestedAt: {
      type: Date,
      required: false
    },
    deletedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true
  }
);

evidenceSchema.index({ userId: 1, reportId: 1, createdAt: -1 });
evidenceSchema.index({ sessionId: 1, reportId: 1, createdAt: -1 });
evidenceSchema.index({ reportId: 1, sha256Hash: 1 });

export const EvidenceModel = model<EvidenceDocument>('Evidence', evidenceSchema);
