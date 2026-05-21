import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { AdminCulturalProfileModel } from '@modules/admin/admin.model';
import {
  getCommunityProfileOptions as getTaxonomyCommunityProfileOptions,
  getCulturalProfileOptions as getTaxonomyCulturalProfileOptions,
  getFaithProfileOptions as getTaxonomyFaithProfileOptions,
  getProfileLanguageOptions
} from '@modules/taxonomies/taxonomies.service';

import {
  DEFAULT_PROFILE_JURISDICTION,
  DEFAULT_PROFILE_LANGUAGE
} from './profile.constants';
import { UserProfileModel } from './profile.model';
import type { UpdateProfileInput } from './profile.schema';
import type { ProfileOwner } from './profile.types';

const uniqueStrings = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

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

const getManagedProfileNames = async (
  communityType: 'cultural' | 'faith' | 'community'
): Promise<string[]> => {
  const profiles = await AdminCulturalProfileModel.find({
    communityType,
    isActive: true,
    validationStatus: 'validated',
    deletedAt: { $exists: false }
  })
    .select('name')
    .sort({ name: 1 })
    .lean();

  return profiles.map((profile) => profile.name);
};

export const getLanguageOptions = getProfileLanguageOptions;
export const getCulturalProfileOptions = async (): Promise<string[]> =>
  uniqueStrings([
    ...(await getTaxonomyCulturalProfileOptions()),
    ...(await getManagedProfileNames('cultural'))
  ]);
export const getFaithProfileOptions = async (): Promise<string[]> =>
  uniqueStrings([
    ...(await getTaxonomyFaithProfileOptions()),
    ...(await getManagedProfileNames('faith'))
  ]);
export const getCommunityProfileOptions = async (): Promise<string[]> =>
  uniqueStrings([
    ...(await getTaxonomyCommunityProfileOptions()),
    ...(await getManagedProfileNames('community'))
  ]);
