import { Schema, model, type Types } from 'mongoose';

import {
  ADMIN_DESTINATION_TYPES,
  ADMIN_TAXONOMY_TYPES,
  PRIVACY_REQUEST_STATUSES
} from './admin.constants';
import type { AdminDestinationType, AdminTaxonomyType, PrivacyRequestStatus } from './admin.types';

export interface AdminTaxonomyDocument {
  _id: Types.ObjectId;
  type: AdminTaxonomyType;
  key: string;
  label: string;
  description?: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminDestinationDocument {
  _id: Types.ObjectId;
  type: AdminDestinationType;
  name: string;
  endpoint?: string;
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
    endpoint: {
      type: String,
      required: false,
      trim: true
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

adminTaxonomySchema.index({ type: 1, key: 1 }, { unique: true });
adminDestinationSchema.index({ type: 1, name: 1 }, { unique: true });

export const AdminTaxonomyModel = model<AdminTaxonomyDocument>(
  'AdminTaxonomy',
  adminTaxonomySchema
);
export const AdminDestinationModel = model<AdminDestinationDocument>(
  'AdminDestination',
  adminDestinationSchema
);
export const PrivacyRequestModel = model<PrivacyRequestDocument>(
  'PrivacyRequest',
  privacyRequestSchema
);
