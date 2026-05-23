import { Schema, model, type Types } from 'mongoose';

import {
  SUPPORT_ISSUE_TYPES,
  SUPPORT_RESOURCE_RISK_LEVELS,
  SUPPORT_RESOURCE_TYPES,
  SUPPORT_REQUEST_STATUSES,
  SUPPORT_SERVICE_CARD_ICONS,
  SUPPORT_SERVICE_OVERLAY_TONES,
  SUPPORT_SERVICE_TYPES
} from './support.constants';
import type {
  SupportRequestStatus,
  SupportServiceCardIcon,
  SupportServiceOverlayTone,
  SupportServiceType,
  SupportResourceRiskLevel,
  SupportResourceType,
  SupportIssueType
} from './support.types';

interface SupportOwnedDocument {
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface WarmReferralDocument extends SupportOwnedDocument {
  serviceId: string;
  serviceName?: string;
  serviceType?: string;
  partnerKey?: string;
  contactPreference: 'phone' | 'email' | 'in_app';
  safeContact: string;
  notes?: string;
  minimalSummary: {
    incidentSummary?: string;
    immediateSafetyConcerns?: string;
    preferredContactMethod?: string;
    interpreterPreference?: string;
    culturalContext?: string;
    informationOnlyDisclaimer: boolean;
  };
  includedFields: string[];
  shareProfileContext: boolean;
  consentSnapshot: {
    warm_referral: boolean;
    capturedAt: Date;
  };
  metadata?: Record<string, unknown>;
  status: SupportRequestStatus;
}

export interface AdvocateRequestDocument extends SupportOwnedDocument {
  advocateType: string;
  language: string;
  issueType?: string;
  region?: string;
  safeContactPreference: 'phone' | 'email' | 'in_app' | 'no_direct_contact';
  notes?: string;
  confirmationCopy?: string;
  status: SupportRequestStatus;
}

export interface HelpSupportRequestDocument extends SupportOwnedDocument {
  title: string;
  message: string;
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

export interface SupportServiceDocument {
  key: string;
  name: string;
  type: SupportServiceType;
  description: string;
  cardImageUrl?: string;
  cardImageAlt?: string;
  cardIcon: SupportServiceCardIcon;
  cardOverlayTone: SupportServiceOverlayTone;
  availabilityLabel: string;
  referralTitle: string;
  referralDescription: string;
  resourceType: SupportResourceType;
  issueTypes: SupportIssueType[];
  safetyRiskLevels: SupportResourceRiskLevel[];
  ctaLabel: string;
  resourceLinks: Array<{
    label: string;
    url: string;
  }>;
  jurisdiction: string;
  regions: string[];
  languages: string[];
  eligibility: string[];
  bookingUrl?: string;
  websiteUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
  crisis: boolean;
  informationOnly: boolean;
  priority: number;
  safetyNotes?: string;
  eligibilityNotes?: string;
  languageSupportNotes?: string;
  isPublished: boolean;
  isActive: boolean;
  sortOrder: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
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
    serviceName: {
      type: String,
      required: false,
      trim: true
    },
    serviceType: {
      type: String,
      required: false,
      trim: true
    },
    partnerKey: {
      type: String,
      required: false,
      trim: true,
      index: true
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
    minimalSummary: {
      incidentSummary: {
        type: String,
        required: false,
        trim: true
      },
      immediateSafetyConcerns: {
        type: String,
        required: false,
        trim: true
      },
      preferredContactMethod: {
        type: String,
        required: false,
        trim: true
      },
      interpreterPreference: {
        type: String,
        required: false,
        trim: true
      },
      culturalContext: {
        type: String,
        required: false,
        trim: true
      },
      informationOnlyDisclaimer: {
        type: Boolean,
        default: true,
        required: true
      }
    },
    includedFields: {
      type: [String],
      default: []
    },
    shareProfileContext: {
      type: Boolean,
      default: false
    },
    consentSnapshot: {
      warm_referral: {
        type: Boolean,
        default: true,
        required: true
      },
      capturedAt: {
        type: Date,
        default: Date.now,
        required: true
      }
    },
    metadata: {
      type: Schema.Types.Mixed,
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
    issueType: {
      type: String,
      required: false,
      trim: true
    },
    region: {
      type: String,
      required: false,
      trim: true
    },
    safeContactPreference: {
      type: String,
      enum: ['phone', 'email', 'in_app', 'no_direct_contact'],
      default: 'in_app',
      required: true
    },
    notes: {
      type: String,
      required: false
    },
    confirmationCopy: {
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

const helpSupportRequestSchema = new Schema<HelpSupportRequestDocument>(
  {
    ...ownerFields,
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
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

warmReferralSchema.index({ status: 1, createdAt: -1 });
warmReferralSchema.index({ serviceId: 1, createdAt: -1 });
helpSupportRequestSchema.index({ status: 1, createdAt: -1 });

const supportServiceSchema = new Schema<SupportServiceDocument>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: SUPPORT_SERVICE_TYPES,
      required: true,
      index: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    cardImageUrl: {
      type: String,
      required: false,
      trim: true
    },
    cardImageAlt: {
      type: String,
      required: false,
      trim: true
    },
    cardIcon: {
      type: String,
      enum: SUPPORT_SERVICE_CARD_ICONS,
      default: 'shield',
      required: true
    },
    cardOverlayTone: {
      type: String,
      enum: SUPPORT_SERVICE_OVERLAY_TONES,
      default: 'default',
      required: true
    },
    availabilityLabel: {
      type: String,
      required: true,
      trim: true,
      default: 'Available Now'
    },
    referralTitle: {
      type: String,
      required: true,
      trim: true,
      default: 'Warm Referral'
    },
    referralDescription: {
      type: String,
      required: true,
      trim: true,
      default:
        'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.'
    },
    resourceType: {
      type: String,
      enum: SUPPORT_RESOURCE_TYPES,
      default: 'government',
      required: true,
      index: true
    },
    issueTypes: {
      type: [String],
      enum: SUPPORT_ISSUE_TYPES,
      default: ['general_support'],
      index: true
    },
    safetyRiskLevels: {
      type: [String],
      enum: SUPPORT_RESOURCE_RISK_LEVELS,
      default: ['all']
    },
    ctaLabel: {
      type: String,
      required: true,
      trim: true,
      default: 'View options'
    },
    resourceLinks: {
      type: [
        {
          label: { type: String, required: true, trim: true },
          url: { type: String, required: true, trim: true }
        }
      ],
      default: []
    },
    jurisdiction: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    regions: {
      type: [String],
      default: []
    },
    languages: {
      type: [String],
      default: ['en']
    },
    eligibility: {
      type: [String],
      default: []
    },
    bookingUrl: {
      type: String,
      required: false,
      trim: true
    },
    websiteUrl: {
      type: String,
      required: false,
      trim: true
    },
    phone: {
      type: String,
      required: false,
      trim: true
    },
    email: {
      type: String,
      required: false,
      trim: true
    },
    address: {
      type: String,
      required: false,
      trim: true
    },
    crisis: {
      type: Boolean,
      default: false,
      index: true
    },
    informationOnly: {
      type: Boolean,
      default: true
    },
    priority: {
      type: Number,
      default: 50,
      index: true
    },
    safetyNotes: {
      type: String,
      required: false,
      trim: true
    },
    eligibilityNotes: {
      type: String,
      required: false,
      trim: true
    },
    languageSupportNotes: {
      type: String,
      required: false,
      trim: true
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    sortOrder: {
      type: Number,
      default: 0
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: false
    }
  },
  { timestamps: true }
);

supportServiceSchema.index({
  isPublished: 1,
  isActive: 1,
  type: 1,
  resourceType: 1,
  jurisdiction: 1
});
supportServiceSchema.index({ sortOrder: 1, name: 1 });

export const WarmReferralModel = model<WarmReferralDocument>('WarmReferral', warmReferralSchema);
export const AdvocateRequestModel = model<AdvocateRequestDocument>(
  'AdvocateRequest',
  advocateRequestSchema
);
export const HelpSupportRequestModel = model<HelpSupportRequestDocument>(
  'HelpSupportRequest',
  helpSupportRequestSchema
);
export const SafetyPlanModel = model<SafetyPlanDocument>('SafetyPlan', safetyPlanSchema);
export const SupportServiceModel = model<SupportServiceDocument>(
  'SupportService',
  supportServiceSchema
);
