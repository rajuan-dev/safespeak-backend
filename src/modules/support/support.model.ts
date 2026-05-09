import { Schema, model, type Types } from 'mongoose';

import { SUPPORT_REQUEST_STATUSES } from './support.constants';
import type { SupportRequestStatus } from './support.types';

interface SupportOwnedDocument {
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface WarmReferralDocument extends SupportOwnedDocument {
  serviceId: string;
  contactPreference: 'phone' | 'email' | 'in_app';
  safeContact: string;
  notes?: string;
  status: SupportRequestStatus;
}

export interface AdvocateRequestDocument extends SupportOwnedDocument {
  advocateType: string;
  language: string;
  notes?: string;
  status: SupportRequestStatus;
}

export interface SafetyPlanDocument extends SupportOwnedDocument {
  title: string;
  trustedContacts: Array<Record<string, unknown>>;
  safePlaces: string[];
  warningSigns: string[];
  copingStrategies: string[];
  emergencySteps: string[];
  isActive: boolean;
}

const ownerFields = {
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
  }
};

const warmReferralSchema = new Schema<WarmReferralDocument>(
  {
    ...ownerFields,
    serviceId: {
      type: String,
      required: true,
      trim: true
    },
    contactPreference: {
      type: String,
      enum: ['phone', 'email', 'in_app'],
      required: true
    },
    safeContact: {
      type: String,
      required: true,
      trim: true
    },
    notes: {
      type: String,
      required: false
    },
    status: {
      type: String,
      enum: SUPPORT_REQUEST_STATUSES,
      default: 'pending',
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

const advocateRequestSchema = new Schema<AdvocateRequestDocument>(
  {
    ...ownerFields,
    advocateType: {
      type: String,
      required: true,
      trim: true
    },
    language: {
      type: String,
      required: true,
      default: 'en'
    },
    notes: {
      type: String,
      required: false
    },
    status: {
      type: String,
      enum: SUPPORT_REQUEST_STATUSES,
      default: 'pending',
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

const safetyPlanSchema = new Schema<SafetyPlanDocument>(
  {
    ...ownerFields,
    title: {
      type: String,
      required: true,
      trim: true
    },
    trustedContacts: [Schema.Types.Mixed],
    safePlaces: {
      type: [String],
      default: []
    },
    warningSigns: {
      type: [String],
      default: []
    },
    copingStrategies: {
      type: [String],
      default: []
    },
    emergencySteps: {
      type: [String],
      default: []
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  { timestamps: true }
);

export const WarmReferralModel = model<WarmReferralDocument>('WarmReferral', warmReferralSchema);
export const AdvocateRequestModel = model<AdvocateRequestDocument>(
  'AdvocateRequest',
  advocateRequestSchema
);
export const SafetyPlanModel = model<SafetyPlanDocument>('SafetyPlan', safetyPlanSchema);
