import dayjs from 'dayjs';
import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { generateSecureToken, hashSensitiveValue } from '@common/utils/crypto';
import { createAuditLog } from '@modules/audit/audit.service';

import {
  ANONYMOUS_SESSION_TTL_DAYS,
  DEFAULT_SESSION_JURISDICTION,
  DEFAULT_SESSION_LANGUAGE
} from './sessions.constants';
import { AnonymousSessionModel } from './sessions.model';
import type { AnonymousSessionDocument } from './sessions.model';
import type { CreateAnonymousSessionInput } from './sessions.schema';
import type { AuthenticatedSession } from './sessions.types';

const toAuthenticatedSession = (
  session: HydratedDocument<AnonymousSessionDocument> | null
): AuthenticatedSession => {
  if (!session) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid session');
  }

  return {
    id: session._id.toString(),
    userId: session.userId?.toString(),
    isAnonymous: session.isAnonymous,
    language: session.language,
    jurisdiction: session.jurisdiction,
    lga: session.lga
  };
};

export const createAnonymousSession = async (
  input: CreateAnonymousSessionInput,
  ip?: string,
  userAgent?: string
): Promise<{ session: AuthenticatedSession; sessionToken: string }> => {
  const sessionToken = generateSecureToken(48);
  const sessionTokenHash = hashSensitiveValue(sessionToken);
  const session = await AnonymousSessionModel.create({
    sessionTokenHash,
    isAnonymous: true,
    safetyGateAcceptedAt: input.safetyGateAccepted ? new Date() : undefined,
    language: input.language ?? DEFAULT_SESSION_LANGUAGE,
    jurisdiction: input.jurisdiction ?? DEFAULT_SESSION_JURISDICTION,
    lga: input.lga,
    consentSnapshot: {},
    expiresAt: dayjs().add(ANONYMOUS_SESSION_TTL_DAYS, 'day').toDate()
  });

  await createAuditLog({
    actorType: 'anonymous_session',
    sessionId: session._id,
    action: 'session.create_anonymous',
    resourceType: 'session',
    resourceId: session._id,
    ip,
    userAgent
  });

  return {
    session: toAuthenticatedSession(session),
    sessionToken
  };
};

export const getSessionByToken = async (sessionToken: string): Promise<AuthenticatedSession> => {
  const sessionTokenHash = hashSensitiveValue(sessionToken);
  const session = await AnonymousSessionModel.findOne({
    sessionTokenHash,
    expiresAt: {
      $gt: new Date()
    }
  });

  return toAuthenticatedSession(session);
};

export const convertSessionToUser = async (
  sessionId: string,
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<AuthenticatedSession> => {
  const session = await AnonymousSessionModel.findByIdAndUpdate(
    sessionId,
    {
      userId,
      isAnonymous: false
    },
    {
      new: true
    }
  );

  const authenticatedSession = toAuthenticatedSession(session);

  await createAuditLog({
    actorType: 'anonymous_session',
    actorId: userId,
    sessionId,
    action: 'session.convert_to_user',
    resourceType: 'session',
    resourceId: sessionId,
    ip,
    userAgent
  });

  return authenticatedSession;
};
