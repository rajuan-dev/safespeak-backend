import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { hashOptionalSensitiveValue } from '@common/utils/crypto';
import { createAuditLog } from '@modules/audit/audit.service';

import { DEFAULT_CONSENT_FLAGS } from './consent.constants';
import { ConsentRecordModel } from './consent.model';
import type { UpdateConsentInput, WithdrawConsentInput } from './consent.schema';
import type { ConsentFlags, ConsentOwner } from './consent.types';

const ownerFilter = (owner: ConsentOwner): ConsentOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

export const getCurrentConsent = async (owner: ConsentOwner): Promise<ConsentFlags> => {
  const latest = await ConsentRecordModel.findOne(ownerFilter(owner)).sort({ version: -1 });

  return latest?.flags ?? { ...DEFAULT_CONSENT_FLAGS };
};

export const getConsentHistory = async (owner: ConsentOwner): Promise<unknown[]> =>
  ConsentRecordModel.find(ownerFilter(owner)).sort({ version: -1 }).lean();

export const createConsentVersion = async (
  owner: ConsentOwner,
  flags: Partial<ConsentFlags>,
  source: string,
  ip?: string,
  userAgent?: string
): Promise<ConsentFlags> => {
  const filter = ownerFilter(owner);
  const latest = await ConsentRecordModel.findOne(filter).sort({ version: -1 });
  const nextFlags = {
    ...(latest?.flags ?? DEFAULT_CONSENT_FLAGS),
    ...flags
  };
  const record = await ConsentRecordModel.create({
    ...filter,
    flags: nextFlags,
    version: (latest?.version ?? 0) + 1,
    source,
    ipHash: hashOptionalSensitiveValue(ip),
    userAgentHash: hashOptionalSensitiveValue(userAgent)
  });

  await createAuditLog({
    actorType: owner.userId ? 'user' : 'anonymous_session',
    actorId: owner.userId,
    sessionId: owner.sessionId,
    action: 'consent.update',
    resourceType: 'consent',
    resourceId: record._id,
    ip,
    userAgent,
    metadata: {
      version: record.version,
      changedFlags: Object.keys(flags)
    }
  });

  return record.flags;
};

export const updateConsent = async (
  owner: ConsentOwner,
  input: UpdateConsentInput,
  ip?: string,
  userAgent?: string
): Promise<ConsentFlags> => createConsentVersion(owner, input.flags, input.source, ip, userAgent);

export const withdrawConsent = async (
  owner: ConsentOwner,
  input: WithdrawConsentInput,
  ip?: string,
  userAgent?: string
): Promise<ConsentFlags> => {
  const withdrawnFlags = Object.fromEntries(
    input.flags.map((flag) => [flag, false])
  ) as Partial<ConsentFlags>;

  return createConsentVersion(owner, withdrawnFlags, input.source, ip, userAgent);
};
