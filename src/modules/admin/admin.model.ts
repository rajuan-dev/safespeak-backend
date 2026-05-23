import { Schema, model, type Types } from 'mongoose';

import {
  ADMIN_CULTURAL_PROFILE_STATUSES,
  ADMIN_CULTURAL_PROFILE_TYPES,
  ADMIN_DESTINATION_CHANNELS,
  ADMIN_DESTINATION_TYPES,
  ADMIN_SUBMISSION_TEMPLATE_ACK_MODES,
  ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES,
  ADMIN_TAXONOMY_TYPES,
  PRIVACY_REQUEST_STATUSES
} from './admin.constants';
import type {
  AdminCulturalProfileStatus,
  AdminCulturalProfileType,
  AdminDestinationChannel,
  AdminDestinationType,
  AdminSubmissionTemplateAckMode,
  AdminSubmissionTemplateAttachmentMode,
  AdminTaxonomyType,
  PrivacyRequestStatus
} from './admin.types';

export interface AdminCulturalProfileDocument {
  _id: Types.ObjectId;
  key: string;
  name: string;
  communityType: AdminCulturalProfileType;
  languages: string[];
  faithPathway?: string;
  responseGuidance: string;
  referralPreferences: string[];
  contentGuidance: string[];
  validationStatus: AdminCulturalProfileStatus;
  reviewCadence: string;
  partnerReviewRequired: boolean;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  isActive: boolean;
  metadata: Record<string, unknown>;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminTaxonomyDocument {
  _id: Types.ObjectId;
  type: AdminTaxonomyType;
  key: string;
  label: string;
  description?: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminDestinationDocument {
  _id: Types.ObjectId;
  type: AdminDestinationType;
  key: string;
  name: string;
  channel: AdminDestinationChannel;
  jurisdiction: string;
  languages: string[];
  endpoint?: string;
  contactEmail?: string;
  contactPhone?: string;
  minimumRequiredInfo: string[];
  anonymityOptions: string[];
  expectedNextSteps: string[];
  consentRequired: boolean;
  supportsAcknowledgement: boolean;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSubmissionTemplateDocument {
  _id: Types.ObjectId;
  key: string;
  name: string;
  destinationType: AdminDestinationType;
  channel: AdminDestinationChannel;
  jurisdiction: string;
  titleTemplate: string;
  summaryTemplate: string;
  fieldMappings: Array<{
    source: string;
    target: string;
    required: boolean;
    transform?: string;
  }>;
  staticPayload: Record<string, unknown>;
  acknowledgementMode: AdminSubmissionTemplateAckMode;
  attachmentMode: AdminSubmissionTemplateAttachmentMode;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacyRequestDocument {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  requestType: string;
  status: PrivacyRequestStatus;
  notes?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminNotificationReadDocument {
  _id: Types.ObjectId;
  adminUserId: Types.ObjectId;
  notificationId: string;
  readAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const adminCulturalProfileSchema = new Schema<AdminCulturalProfileDocument>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    communityType: {
      type: String,
      enum: ADMIN_CULTURAL_PROFILE_TYPES,
      required: true,
      index: true
    },
    languages: {
      type: [String],
      required: true,
      default: ['en']
    },
    faithPathway: {
      type: String,
      required: false,
      trim: true
    },
    responseGuidance: {
      type: String,
      required: true,
      trim: true
    },
    referralPreferences: {
      type: [String],
      required: true,
      default: []
    },
    contentGuidance: {
      type: [String],
      required: true,
      default: []
    },
    validationStatus: {
      type: String,
      enum: ADMIN_CULTURAL_PROFILE_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    reviewCadence: {
      type: String,
      required: true,
      trim: true,
      default: 'Quarterly partner review'
    },
    partnerReviewRequired: {
      type: Boolean,
      required: true,
      default: true
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    reviewedAt: {
      type: Date,
      required: false
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    deletedAt: {
      type: Date,
      required: false,
      index: true
    }
  },
  { timestamps: true }
);

const adminTaxonomySchema = new Schema<AdminTaxonomyDocument>(
  {
    type: {
      type: String,
      enum: ADMIN_TAXONOMY_TYPES,
      required: true,
      index: true
    },
    key: {
      type: String,
      required: true,
      trim: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: false
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    deletedAt: {
      type: Date,
      required: false,
      index: true
    }
  },
  { timestamps: true }
);

const adminDestinationSchema = new Schema<AdminDestinationDocument>(
  {
    type: {
      type: String,
      enum: ADMIN_DESTINATION_TYPES,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    key: {
      type: String,
      required: true,
      trim: true
    },
    channel: {
      type: String,
      enum: ADMIN_DESTINATION_CHANNELS,
      required: true,
      index: true
    },
    jurisdiction: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    languages: {
      type: [String],
      required: true,
      default: ['en']
    },
    endpoint: {
      type: String,
      required: false,
      trim: true
    },
    contactEmail: {
      type: String,
      required: false,
      trim: true
    },
    contactPhone: {
      type: String,
      required: false,
      trim: true
    },
    minimumRequiredInfo: {
      type: [String],
      required: true,
      default: []
    },
    anonymityOptions: {
      type: [String],
      required: true,
      default: []
    },
    expectedNextSteps: {
      type: [String],
      required: true,
      default: []
    },
    consentRequired: {
      type: Boolean,
      required: true,
      default: true
    },
    supportsAcknowledgement: {
      type: Boolean,
      required: true,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

const adminSubmissionTemplateSchema = new Schema<AdminSubmissionTemplateDocument>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    destinationType: {
      type: String,
      enum: ADMIN_DESTINATION_TYPES,
      required: true,
      index: true
    },
    channel: {
      type: String,
      enum: ADMIN_DESTINATION_CHANNELS,
      required: true,
      index: true
    },
    jurisdiction: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    titleTemplate: {
      type: String,
      required: true,
      trim: true
    },
    summaryTemplate: {
      type: String,
      required: true,
      trim: true
    },
    fieldMappings: {
      type: [
        new Schema(
          {
            source: { type: String, required: true, trim: true },
            target: { type: String, required: true, trim: true },
            required: { type: Boolean, required: true, default: false },
            transform: { type: String, required: false, trim: true }
          },
          { _id: false }
        )
      ],
      default: []
    },
    staticPayload: {
      type: Schema.Types.Mixed,
      default: {}
    },
    acknowledgementMode: {
      type: String,
      enum: ADMIN_SUBMISSION_TEMPLATE_ACK_MODES,
      required: true,
      default: 'manual'
    },
    attachmentMode: {
      type: String,
      enum: ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES,
      required: true,
      default: 'metadata_only'
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

const privacyRequestSchema = new Schema<PrivacyRequestDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'AnonymousSession',
      required: false,
      index: true
    },
    requestType: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: PRIVACY_REQUEST_STATUSES,
      default: 'pending',
      required: true,
      index: true
    },
    notes: {
      type: String,
      required: false
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    reviewedAt: {
      type: Date,
      required: false
    }
  },
  { timestamps: true }
);

const adminNotificationReadSchema = new Schema<AdminNotificationReadDocument>(
  {
    adminUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    notificationId: {
      type: String,
      required: true,
      trim: true
    },
    readAt: {
      type: Date,
      required: true,
      default: Date.now
    }
  },
  { timestamps: true }
);

adminCulturalProfileSchema.index(
  { communityType: 1, validationStatus: 1, isActive: 1, deletedAt: 1 }
);
adminTaxonomySchema.index({ type: 1, key: 1 }, { unique: true });
adminDestinationSchema.index({ type: 1, key: 1 }, { unique: true });
adminSubmissionTemplateSchema.index({ destinationType: 1, channel: 1, jurisdiction: 1, isActive: 1 });
adminNotificationReadSchema.index({ adminUserId: 1, notificationId: 1 }, { unique: true });

export const AdminTaxonomyModel = model<AdminTaxonomyDocument>(
  'AdminTaxonomy',
  adminTaxonomySchema
);
export const AdminCulturalProfileModel = model<AdminCulturalProfileDocument>(
  'AdminCulturalProfile',
  adminCulturalProfileSchema
);
export const AdminDestinationModel = model<AdminDestinationDocument>(
  'AdminDestination',
  adminDestinationSchema
);
export const AdminSubmissionTemplateModel = model<AdminSubmissionTemplateDocument>(
  'AdminSubmissionTemplate',
  adminSubmissionTemplateSchema
);
export const PrivacyRequestModel = model<PrivacyRequestDocument>(
  'PrivacyRequest',
  privacyRequestSchema
);
export const AdminNotificationReadModel = model<AdminNotificationReadDocument>(
  'AdminNotificationRead',
  adminNotificationReadSchema
);
