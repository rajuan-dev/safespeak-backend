import { Schema, model, type Types } from 'mongoose';

import {
  SCAMSHIELD_ANALYSIS_TYPES,
  SCAMSHIELD_RISK_LEVELS,
  SCAMSHIELD_STATUSES
} from './scamshield.constants';
import type {
  ScamShieldAnalysisType,
  ScamShieldRiskLevel,
  ScamShieldStatus
} from './scamshield.types';

export interface ScamShieldAnalysisDocument {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  reportId?: Types.ObjectId;
  type: ScamShieldAnalysisType;
  inputHash: string;
  riskLevel: ScamShieldRiskLevel;
  riskScore: number;
  confidence?: string;
  summary?: string;
  indicators: string[];
  redFlags: string[];
  recommendations: string[];
  extractedEntities?: Record<string, unknown>;
  redactedContent?: string;
  draftReport?: Record<string, unknown>;
  status: ScamShieldStatus;
  submittedAt?: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const scamShieldAnalysisSchema = new Schema<ScamShieldAnalysisDocument>(
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
    reportId: {
      type: Schema.Types.ObjectId,
      ref: 'Report',
      required: false,
      index: true
    },
    type: {
      type: String,
      enum: SCAMSHIELD_ANALYSIS_TYPES,
      required: true,
      index: true
    },
    inputHash: {
      type: String,
      required: true,
      index: true
    },
    riskLevel: {
      type: String,
      enum: SCAMSHIELD_RISK_LEVELS,
      required: true
    },
    riskScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    confidence: {
      type: String,
      required: false
    },
    summary: {
      type: String,
      required: false
    },
    indicators: {
      type: [String],
      default: []
    },
    redFlags: {
      type: [String],
      default: []
    },
    recommendations: {
      type: [String],
      default: []
    },
    extractedEntities: {
      type: Schema.Types.Mixed,
      required: false
    },
    redactedContent: {
      type: String,
      required: false
    },
    draftReport: {
      type: Schema.Types.Mixed,
      required: false
    },
    status: {
      type: String,
      enum: SCAMSHIELD_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    submittedAt: {
      type: Date,
      required: false
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

scamShieldAnalysisSchema.index({ userId: 1, createdAt: -1 });
scamShieldAnalysisSchema.index({ sessionId: 1, createdAt: -1 });

export const ScamShieldAnalysisModel = model<ScamShieldAnalysisDocument>(
  'ScamShieldAnalysis',
  scamShieldAnalysisSchema
);
