import { Schema, model } from 'mongoose';

import { REPORT_SEVERITIES, REPORT_STATUSES } from './reports.constants';
import type { ReportOwnerType, ReportSeverity, ReportStatus } from './reports.types';

export interface ReportStatusHistoryItem {
  status: ReportStatus;
  changedAt: Date;
  reason?: string;
}

export interface ReportDocument {
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

reportSchema.index({ userId: 1, createdAt: -1 });
reportSchema.index({ sessionId: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });

export const ReportModel = model<ReportDocument>('Report', reportSchema);
