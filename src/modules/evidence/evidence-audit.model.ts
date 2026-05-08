import { Schema, model, type Types } from 'mongoose';

export interface EvidenceAuditChainDocument {
  _id: Types.ObjectId;
  evidenceId: Types.ObjectId;
  reportId: Types.ObjectId;
  actorType: 'user' | 'anonymous_session' | 'system';
  actorId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  action: string;
  sequence: number;
  previousHash?: string;
  eventHash: string;
  signature: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const evidenceAuditChainSchema = new Schema<EvidenceAuditChainDocument>(
  {
    evidenceId: {
      type: Schema.Types.ObjectId,
      ref: 'Evidence',
      required: true,
      index: true
    },
    reportId: {
      type: Schema.Types.ObjectId,
      ref: 'Report',
      required: true,
      index: true
    },
    actorType: {
      type: String,
      enum: ['user', 'anonymous_session', 'system'],
      required: true
    },
    actorId: {
      type: Schema.Types.ObjectId,
      required: false
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      required: false
    },
    action: {
      type: String,
      required: true,
      trim: true
    },
    sequence: {
      type: Number,
      required: true,
      min: 1
    },
    previousHash: {
      type: String,
      required: false
    },
    eventHash: {
      type: String,
      required: true
    },
    signature: {
      type: String,
      required: true
    },
    metadata: {
      type: Schema.Types.Mixed,
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

evidenceAuditChainSchema.index({ evidenceId: 1, sequence: 1 }, { unique: true });

export const EvidenceAuditChainModel = model<EvidenceAuditChainDocument>(
  'EvidenceAuditChain',
  evidenceAuditChainSchema
);
