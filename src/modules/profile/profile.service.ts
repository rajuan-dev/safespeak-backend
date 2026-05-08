import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';

import {
  COMMUNITY_PROFILE_OPTIONS,
  CULTURAL_PROFILE_OPTIONS,
  DEFAULT_PROFILE_JURISDICTION,
  DEFAULT_PROFILE_LANGUAGE,
  FAITH_PROFILE_OPTIONS,
  LANGUAGE_OPTIONS
} from './profile.constants';
import { UserProfileModel } from './profile.model';
import type { UpdateProfileInput } from './profile.schema';
import type { ProfileOwner } from './profile.types';

const ownerFilter = (owner: ProfileOwner): ProfileOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

export const getProfile = async (owner: ProfileOwner): Promise<unknown> => {
  const filter = ownerFilter(owner);
  const profile = await UserProfileModel.findOne(filter).lean();

  return (
    profile ?? {
      ...filter,
      preferredLanguage: DEFAULT_PROFILE_LANGUAGE,
      jurisdiction: DEFAULT_PROFILE_JURISDICTION,
      referralSharingPreference: false,
      accessibilityPreferences: {}
    }
  );
};

export const updateProfile = async (
  owner: ProfileOwner,
  input: UpdateProfileInput,
  ip?: string,
  userAgent?: string
): Promise<unknown> => {
  const filter = ownerFilter(owner);
  const profile = await UserProfileModel.findOneAndUpdate(
    filter,
    {
      $set: input,
      $setOnInsert: filter
    },
    {
      upsert: true,
      new: true
    }
  ).lean();

  await createAuditLog({
    actorType: owner.userId ? 'user' : 'anonymous_session',
    actorId: owner.userId,
    sessionId: owner.sessionId,
    action: 'profile.update',
    resourceType: 'profile',
    resourceId: profile?._id,
    ip,
    userAgent,
    metadata: {
      changedFields: Object.keys(input)
    }
  });

  return profile;
};

export const getLanguageOptions = (): typeof LANGUAGE_OPTIONS => LANGUAGE_OPTIONS;
export const getCulturalProfileOptions = (): typeof CULTURAL_PROFILE_OPTIONS =>
  CULTURAL_PROFILE_OPTIONS;
export const getFaithProfileOptions = (): typeof FAITH_PROFILE_OPTIONS => FAITH_PROFILE_OPTIONS;
export const getCommunityProfileOptions = (): typeof COMMUNITY_PROFILE_OPTIONS =>
  COMMUNITY_PROFILE_OPTIONS;
