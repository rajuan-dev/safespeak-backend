import { Schema, model, type Types } from 'mongoose';

import {
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  REPORT_SUBMISSION_ANONYMITY_MODES,
  REPORT_SUBMISSION_STATUSES
} from './reports.constants';
import type {
  ReportOwnerType,
  ReportSeverity,
  ReportStatus,
  ReportSubmissionAnonymityMode,
  ReportSubmissionStatus
} from './reports.types';

export interface ReportStatusHistoryItem {
  status: ReportStatus;
  changedAt: Date;
  reason?: string;
}

export interface ReportDocument {
  _id: Types.ObjectId;
  refNo: string;
  userId?: Schema.Types.ObjectId;
  sessionId?: Schema.Types.ObjectId;
  ownerType: ReportOwnerType;
  language: string;
  jurisdiction: string;
  lga?: string;
  context?: string;
  originalNarrative?: string;
  translatedNarrative?: string;
  incidentType?: string;
  severity?: ReportSeverity;
  structuredFields: Record<string, unknown>;
  consentSnapshot: Record<string, unknown>;
  status: ReportStatus;
  statusHistory: ReportStatusHistoryItem[];
  deletionRequestedAt?: Date;
  withdrawnAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface ReportSubmissionDocument {
  _id: Types.ObjectId;
  reportId: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  ownerType: ReportOwnerType;
  destinationId: Types.ObjectId;
  templateId?: Types.ObjectId;
  templateKey?: string;
  destinationKey: string;
  destinationType: string;
  destinationName: string;
  channel: string;
  jurisdiction: string;
  languages: string[];
  status: ReportSubmissionStatus;
  anonymityMode: ReportSubmissionAnonymityMode;
  minimumRequiredInfo: string[];
  missingRequiredInfo: string[];
  requiredConsentFlags: string[];
  expectedNextSteps: string[];
  notes?: string;
  endpoint?: string;
  contactEmail?: string;
  contactPhone?: string;
  payloadSnapshot: Record<string, unknown>;
  evidenceSnapshot: Array<Record<string, unknown>>;
  consentSnapshot: Record<string, unknown>;
  deliveryArtifacts: Array<Record<string, unknown>>;
  deliveryMessage?: string;
  deliveryMode?: 'automated' | 'manual' | 'config_missing';
  deliveryConfigurationStatus?: 'ready' | 'manual_action' | 'config_missing';
  deliveryConfigurationIssues: string[];
  actuallySent: boolean;
  externalReference?: string;
  acknowledgementMessage?: string;
  acknowledgementPayload?: Record<string, unknown>;
  previewGeneratedAt: Date;
  submittedAt?: Date;
  acknowledgementReceivedAt?: Date;
  lastAttemptAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const statusHistorySchema = new Schema<ReportStatusHistoryItem>(
  {
    status: {
      type: String,
      enum: REPORT_STATUSES,
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    reason: {
      type: String,
      required: false
    }
  },
  {
    _id: false
  }
);

const reportSchema = new Schema<ReportDocument>(
  {
    refNo: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
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
    ownerType: {
      type: String,
      enum: ['anonymous', 'user'],
      required: true
    },
    language: {
      type: String,
      default: 'en',
      required: true
    },
    jurisdiction: {
      type: String,
      default: 'NSW',
      required: true
    },
    lga: {
      type: String,
      required: false
    },
    context: {
      type: String,
      required: false
    },
    originalNarrative: {
      type: String,
      required: false
    },
    translatedNarrative: {
      type: String,
      required: false
    },
    incidentType: {
      type: String,
      required: false
    },
    severity: {
      type: String,
      enum: REPORT_SEVERITIES,
      required: false
    },
    structuredFields: {
      type: Schema.Types.Mixed,
      default: {}
    },
    consentSnapshot: {
      type: Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: 'draft',
      required: true
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: []
    },
    deletionRequestedAt: {
      type: Date,
      required: false
    },
    withdrawnAt: {
      type: Date,
      required: false
    },
    deletedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true
  }
);

const reportSubmissionSchema = new Schema<ReportSubmissionDocument>(
  {
    reportId: {
      type: Schema.Types.ObjectId,
      ref: 'Report',
      required: true,
      index: true
    },
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
    ownerType: {
      type: String,
      enum: ['anonymous', 'user'],
      required: true
    },
    destinationId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminDestination',
      required: true,
      index: true
    },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminSubmissionTemplate',
      required: false
    },
    templateKey: {
      type: String,
      required: false,
      trim: true
    },
    destinationKey: {
      type: String,
      required: true,
      trim: true
    },
    destinationType: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    destinationName: {
      type: String,
      required: true,
      trim: true
    },
    channel: {
      type: String,
      required: true,
      trim: true
    },
    jurisdiction: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    languages: {
      type: [String],
      default: ['en'],
      required: true
    },
    status: {
      type: String,
      enum: REPORT_SUBMISSION_STATUSES,
      default: 'draft_preview',
      required: true,
      index: true
    },
    anonymityMode: {
      type: String,
      enum: REPORT_SUBMISSION_ANONYMITY_MODES,
      default: 'identified',
      required: true
    },
    minimumRequiredInfo: {
      type: [String],
      default: [],
      required: true
    },
    missingRequiredInfo: {
      type: [String],
      default: [],
      required: true
    },
    requiredConsentFlags: {
      type: [String],
      default: [],
      required: true
    },
    expectedNextSteps: {
      type: [String],
      default: [],
      required: true
    },
    notes: {
      type: String,
      required: false
    },
    endpoint: {
      type: String,
      required: false
    },
    contactEmail: {
      type: String,
      required: false
    },
    contactPhone: {
      type: String,
      required: false
    },
    payloadSnapshot: {
      type: Schema.Types.Mixed,
      default: {}
    },
    evidenceSnapshot: {
      type: [Object],
      default: []
    },
    consentSnapshot: {
      type: Schema.Types.Mixed,
      default: {}
    },
    deliveryArtifacts: {
      type: [Object],
      default: []
    },
    deliveryMessage: {
      type: String,
      required: false
    },
    deliveryMode: {
      type: String,
      enum: ['automated', 'manual', 'config_missing'],
      required: false
    },
    deliveryConfigurationStatus: {
      type: String,
      enum: ['ready', 'manual_action', 'config_missing'],
      required: false,
      index: true
    },
    deliveryConfigurationIssues: {
      type: [String],
      default: []
    },
    actuallySent: {
      type: Boolean,
      default: false,
      required: true,
      index: true
    },
    externalReference: {
      type: String,
      required: false
    },
    acknowledgementMessage: {
      type: String,
      required: false
    },
    acknowledgementPayload: {
      type: Schema.Types.Mixed,
      default: undefined
    },
    previewGeneratedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    submittedAt: {
      type: Date,
      required: false
    },
    acknowledgementReceivedAt: {
      type: Date,
      required: false
    },
    lastAttemptAt: {
      type: Date,
      required: false
    },
    deletedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true
  }
);

reportSchema.index({ userId: 1, createdAt: -1 });
reportSchema.index({ sessionId: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSubmissionSchema.index({ reportId: 1, createdAt: -1 });
reportSubmissionSchema.index({ userId: 1, reportId: 1, createdAt: -1 });
reportSubmissionSchema.index({ sessionId: 1, reportId: 1, createdAt: -1 });
reportSubmissionSchema.index(
  { reportId: 1, destinationId: 1, status: 1 },
  { partialFilterExpression: { deletedAt: { $exists: false } } }
);

export const ReportModel = model<ReportDocument>('Report', reportSchema);
export const ReportSubmissionModel = model<ReportSubmissionDocument>(
  'ReportSubmission',
  reportSubmissionSchema
);
