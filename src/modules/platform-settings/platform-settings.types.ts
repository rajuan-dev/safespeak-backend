import type { Types } from 'mongoose';

export type PlatformSettingsPayload = {
  safety: {
    immediateDangerText: string;
    respectSupportText: string;
    platformRoleText: string;
    informationOnlyText: string;
    emergencyCallLabel: string;
    respectCallLabel: string;
    quickExitLabel: string;
    covertModeLabel: string;
  };
  consent: {
    introText: string;
    localStorageLabel: string;
    cloudSyncLabel: string;
    agencySharingLabel: string;
    analyticsLabel: string;
  };
  ai: {
    disclaimerText: string;
    humanReviewText: string;
  };
};

export type PlatformSettingsServiceContext = {
  actor?: {
    userId?: string;
  };
  ip?: string;
  userAgent?: string;
};

export type PlatformSettingsActorFields = {
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
};
