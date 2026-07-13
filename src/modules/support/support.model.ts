import { Schema, model, type Types } from 'mongoose';

import {
  ADVOCATE_AVAILABILITIES,
  ADVOCATE_OPT_IN_STATUSES,
  ADVOCATE_REQUEST_STATUSES,
  ADVOCATE_VETTING_STATUSES,
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
  SupportIssueType,
  AdvocateAvailability,
  AdvocateOptInStatus,
  AdvocateRequestStatus,
  AdvocateVettingStatus
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
  reference?: string;
  advocateType: string;
  advocateProfileId?: Types.ObjectId;
  advocateKey?: string;
  advocateSnapshot?: {
    key: string;
    displayName: string;
    publicBio?: string;
    languages: string[];
    issueTypes: string[];
    regions: string[];
    culturalProfiles: string[];
    faithProfiles: string[];
    availability: AdvocateAvailability;
  };
  language: string;
  issueType?: string;
  region?: string;
  safeContactPreference: 'phone' | 'email' | 'in_app' | 'no_direct_contact';
  notes?: string;
  confirmationCopy?: string;
  consentSnapshot?: {
    advocate_request: boolean;
    capturedAt: Date;
  };
  assignedAdvocateProfileId?: Types.ObjectId;
  assignedAdvocateKey?: string;
  assignedAdvocateSnapshot?: AdvocateRequestDocument['advocateSnapshot'];
  assignedAt?: Date;
  assignedBy?: Types.ObjectId;
  adminNotes?: Array<{
    action?: 'assign' | 'reassign' | 'contact_initiated' | 'decline' | 'close';
    note: string;
    createdAt: Date;
    createdBy?: Types.ObjectId;
  }>;
  statusHistory?: Array<{
    previousStatus?: AdvocateRequestStatus;
    status: AdvocateRequestStatus;
    actorType: 'user' | 'admin' | 'system' | 'anonymous_session';
    actorId?: Types.ObjectId;
    reasonCode?: string;
    createdAt: Date;
  }>;
  status: AdvocateRequestStatus;
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
  deletedAt?: Date;
  sortOrder: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdvocateProfileDocument {
  key: string;
  displayName: string;
  publicBio?: string;
  languages: string[];
  regions: string[];
  issueTypes: SupportIssueType[];
  culturalProfiles: string[];
  faithProfiles: string[];
  availability: AdvocateAvailability;
  isActive: boolean;
  isPublished: boolean;
  optInStatus: AdvocateOptInStatus;
  vetting: {
    status: AdvocateVettingStatus;
    reviewedAt?: Date;
    reviewedBy?: Types.ObjectId;
    notes?: string;
  };
  trainingCredentials: Array<{
    title: string;
    provider?: string;
    completedAt?: Date;
    expiresAt?: Date;
    verificationSummary?: string;
  }>;
  internalContactReference?: string;
  privateEmail?: string;
  privatePhone?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
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
    reference: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      index: true
    },
    advocateType: {
      type: String,
      required: true,
      trim: true
    },
    advocateProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'AdvocateProfile',
      required: false,
      index: true
    },
    advocateKey: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      index: true
    },
    advocateSnapshot: {
      key: { type: String, required: false, trim: true },
      displayName: { type: String, required: false, trim: true },
      publicBio: { type: String, required: false, trim: true },
      languages: { type: [String], default: [] },
      issueTypes: { type: [String], default: [] },
      regions: { type: [String], default: [] },
      culturalProfiles: { type: [String], default: [] },
      faithProfiles: { type: [String], default: [] },
      availability: { type: String, enum: ADVOCATE_AVAILABILITIES, required: false }
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
    consentSnapshot: {
      advocate_request: {
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
    assignedAdvocateProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'AdvocateProfile',
      required: false,
      index: true
    },
    assignedAdvocateKey: {
      type: String,
      required: false,
      trim: true,
      lowercase: true
    },
    assignedAdvocateSnapshot: {
      key: { type: String, required: false, trim: true },
      displayName: { type: String, required: false, trim: true },
      publicBio: { type: String, required: false, trim: true },
      languages: { type: [String], default: [] },
      issueTypes: { type: [String], default: [] },
      regions: { type: [String], default: [] },
      culturalProfiles: { type: [String], default: [] },
      faithProfiles: { type: [String], default: [] },
      availability: { type: String, enum: ADVOCATE_AVAILABILITIES, required: false }
    },
    assignedAt: {
      type: Date,
      required: false
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      required: false
    },
    adminNotes: {
      type: [
        {
          action: {
            type: String,
            enum: ['assign', 'reassign', 'contact_initiated', 'decline', 'close'],
            required: false
          },
          note: { type: String, required: true, trim: true },
          createdAt: { type: Date, default: Date.now, required: true },
          createdBy: { type: Schema.Types.ObjectId, required: false }
        }
      ],
      default: []
    },
    statusHistory: {
      type: [
        {
          previousStatus: { type: String, enum: ADVOCATE_REQUEST_STATUSES, required: false },
          status: { type: String, enum: ADVOCATE_REQUEST_STATUSES, required: true },
          actorType: {
            type: String,
            enum: ['user', 'admin', 'system', 'anonymous_session'],
            required: true
          },
          actorId: { type: Schema.Types.ObjectId, required: false },
          reasonCode: { type: String, required: false, trim: true },
          createdAt: { type: Date, default: Date.now, required: true }
        }
      ],
      default: []
    },
    status: {
      type: String,
      enum: ADVOCATE_REQUEST_STATUSES,
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
    deletedAt: {
      type: Date,
      required: false,
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

const advocateProfileSchema = new Schema<AdvocateProfileDocument>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true
    },
    publicBio: {
      type: String,
      required: false,
      trim: true
    },
    languages: {
      type: [String],
      default: ['en'],
      index: true
    },
    regions: {
      type: [String],
      default: ['national'],
      index: true
    },
    issueTypes: {
      type: [String],
      enum: SUPPORT_ISSUE_TYPES,
      default: ['general_support'],
      index: true
    },
    culturalProfiles: {
      type: [String],
      default: [],
      index: true
    },
    faithProfiles: {
      type: [String],
      default: [],
      index: true
    },
    availability: {
      type: String,
      enum: ADVOCATE_AVAILABILITIES,
      default: 'request_based',
      required: true,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true
    },
    optInStatus: {
      type: String,
      enum: ADVOCATE_OPT_IN_STATUSES,
      default: 'pending',
      required: true,
      index: true
    },
    vetting: {
      status: {
        type: String,
        enum: ADVOCATE_VETTING_STATUSES,
        default: 'pending',
        required: true,
        index: true
      },
      reviewedAt: {
        type: Date,
        required: false
      },
      reviewedBy: {
        type: Schema.Types.ObjectId,
        required: false
      },
      notes: {
        type: String,
        required: false,
        trim: true
      }
    },
    trainingCredentials: {
      type: [
        {
          title: { type: String, required: true, trim: true },
          provider: { type: String, required: false, trim: true },
          completedAt: { type: Date, required: false },
          expiresAt: { type: Date, required: false },
          verificationSummary: { type: String, required: false, trim: true }
        }
      ],
      default: []
    },
    internalContactReference: {
      type: String,
      required: false,
      trim: true
    },
    privateEmail: {
      type: String,
      required: false,
      trim: true
    },
    privatePhone: {
      type: String,
      required: false,
      trim: true
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      required: false
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      required: false
    },
    deletedAt: {
      type: Date,
      required: false,
      index: true
    }
  },
  { timestamps: true }
);

advocateProfileSchema.index({
  isPublished: 1,
  isActive: 1,
  optInStatus: 1,
  'vetting.status': 1,
  availability: 1
});
advocateProfileSchema.index({ displayName: 1 });
advocateRequestSchema.index({ status: 1, createdAt: -1 });
advocateRequestSchema.index({ advocateProfileId: 1, status: 1 });

export const WarmReferralModel = model<WarmReferralDocument>('WarmReferral', warmReferralSchema);
export const AdvocateRequestModel = model<AdvocateRequestDocument>(
  'AdvocateRequest',
  advocateRequestSchema
);
export const AdvocateProfileModel = model<AdvocateProfileDocument>(
  'AdvocateProfile',
  advocateProfileSchema
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
