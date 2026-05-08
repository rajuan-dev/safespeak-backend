import type { Types } from 'mongoose';

import type { AUDIT_ACTOR_TYPES, AUDIT_RESOURCE_TYPES } from './audit.constants';

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export interface CreateAuditLogInput {
  actorType: AuditActorType;
  actorId?: string | Types.ObjectId;
  sessionId?: string | Types.ObjectId;
  action: string;
  resourceType: AuditResourceType;
  resourceId?: string | Types.ObjectId;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}
