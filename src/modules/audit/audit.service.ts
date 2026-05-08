import { hashOptionalSensitiveValue } from '@common/utils/crypto';

import { AuditLogModel } from './audit.model';
import type { CreateAuditLogInput } from './audit.types';

export const createAuditLog = async (input: CreateAuditLogInput): Promise<void> => {
  await AuditLogModel.create({
    actorType: input.actorType,
    actorId: input.actorId,
    sessionId: input.sessionId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipHash: hashOptionalSensitiveValue(input.ip),
    userAgentHash: hashOptionalSensitiveValue(input.userAgent),
    metadata: input.metadata
  });
};
