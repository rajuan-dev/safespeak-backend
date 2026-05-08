import { Schema, model } from 'mongoose';

import { DEFAULT_PROFILE_JURISDICTION, DEFAULT_PROFILE_LANGUAGE } from './profile.constants';

export interface UserProfileDocument {
  userId?: Schema.Types.ObjectId;
  sessionId?: Schema.Types.ObjectId;
  preferredLanguage: string;
  interpreterLanguage?: string;
  jurisdiction: string;
  lga?: string;
  culturalProfile?: string;
  faithProfile?: string;
  communityProfile?: string;
  referralSharingPreference: boolean;
  accessibilityPreferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const userProfileSchema = new Schema<UserProfileDocument>(
  {
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
    preferredLanguage: {
      type: String,
      default: DEFAULT_PROFILE_LANGUAGE
    },
    interpreterLanguage: {
      type: String,
      required: false
    },
    jurisdiction: {
      type: String,
      default: DEFAULT_PROFILE_JURISDICTION
    },
    lga: {
      type: String,
      required: false
    },
    culturalProfile: {
      type: String,
      required: false
    },
    faithProfile: {
      type: String,
      required: false
    },
    communityProfile: {
      type: String,
      required: false
    },
    referralSharingPreference: {
      type: Boolean,
      default: false
    },
    accessibilityPreferences: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

userProfileSchema.index({ userId: 1 }, { sparse: true });
userProfileSchema.index({ sessionId: 1 }, { sparse: true });

export const UserProfileModel = model<UserProfileDocument>('UserProfile', userProfileSchema);
