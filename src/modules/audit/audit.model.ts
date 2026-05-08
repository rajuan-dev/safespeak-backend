import { Schema, model } from 'mongoose';

import { AUDIT_ACTOR_TYPES, AUDIT_RESOURCE_TYPES } from './audit.constants';
import type { AuditActorType, AuditResourceType } from './audit.types';

export interface AuditLogDocument {
  actorType: AuditActorType;
  actorId?: Schema.Types.ObjectId;
  sessionId?: Schema.Types.ObjectId;
  action: string;
  resourceType: AuditResourceType;
  resourceId?: Schema.Types.ObjectId;
  ipHash?: string;
  userAgentHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    actorType: {
      type: String,
      enum: AUDIT_ACTOR_TYPES,
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
    resourceType: {
      type: String,
      enum: AUDIT_RESOURCE_TYPES,
      required: true
    },
    resourceId: {
      type: Schema.Types.ObjectId,
      required: false
    },
    ipHash: {
      type: String,
      required: false
    },
    userAgentHash: {
      type: String,
      required: false
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

auditLogSchema.index({ actorType: 1, actorId: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLogDocument>('AuditLog', auditLogSchema);
