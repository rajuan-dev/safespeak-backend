import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

import { DEFAULT_PLATFORM_SETTINGS, PLATFORM_SETTINGS_KEY } from './platform-settings.constants';
import type { PlatformSettingsPayload } from './platform-settings.types';

export interface PlatformSettingsDocument {
  _id: Types.ObjectId;
  key: string;
  draft: PlatformSettingsPayload;
  published: PlatformSettingsPayload;
  version: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PlatformSettingsHydratedDocument = HydratedDocument<PlatformSettingsDocument>;

const platformSettingsPayloadSchema = new Schema<PlatformSettingsPayload>(
  {
    safety: {
      immediateDangerText: { type: String, required: true, trim: true },
      respectSupportText: { type: String, required: true, trim: true },
      platformRoleText: { type: String, required: true, trim: true },
      informationOnlyText: { type: String, required: true, trim: true },
      emergencyCallLabel: { type: String, required: true, trim: true },
      respectCallLabel: { type: String, required: true, trim: true },
      quickExitLabel: { type: String, required: true, trim: true },
      covertModeLabel: { type: String, required: true, trim: true }
    },
    consent: {
      introText: { type: String, required: true, trim: true },
      localStorageLabel: { type: String, required: true, trim: true },
      cloudSyncLabel: { type: String, required: true, trim: true },
      agencySharingLabel: { type: String, required: true, trim: true },
      analyticsLabel: { type: String, required: true, trim: true }
    },
    ai: {
      disclaimerText: { type: String, required: true, trim: true },
      humanReviewText: { type: String, required: true, trim: true },
      triageSystemPrompt: { type: String, required: true, trim: true },
      triageResponseTemplate: { type: String, required: true, trim: true },
      triageFallbackText: { type: String, required: true, trim: true },
      triageTemplateStatus: {
        type: String,
        enum: ['draft', 'approved'],
        required: true,
        default: 'draft'
      }
    }
  },
  { _id: false }
);

const platformSettingsSchema = new Schema<PlatformSettingsDocument>(
  {
    key: {
      type: String,
      default: PLATFORM_SETTINGS_KEY,
      required: true,
      unique: true,
      index: true
    },
    draft: {
      type: platformSettingsPayloadSchema,
      required: true,
      default: () => DEFAULT_PLATFORM_SETTINGS
    },
    published: {
      type: platformSettingsPayloadSchema,
      required: true,
      default: () => DEFAULT_PLATFORM_SETTINGS
    },
    version: { type: Number, default: 1, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    publishedAt: { type: Date, required: false }
  },
  { timestamps: true }
);

export const PlatformSettingsModel = model<PlatformSettingsDocument>(
  'PlatformSettings',
  platformSettingsSchema
);
