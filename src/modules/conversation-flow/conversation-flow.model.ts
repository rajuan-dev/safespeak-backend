import { Schema, model, type Types } from 'mongoose';

import {
  CONVERSATION_FLOW_CATEGORIES,
  CONVERSATION_FLOW_MESSAGE_ROLES,
  CONVERSATION_FLOW_RISK_LEVELS,
  CONVERSATION_FLOW_STATUSES
} from './conversation-flow.constants';
import type {
  ConversationFlowCategory,
  ConversationFlowMessageRole,
  ConversationFlowRiskLevel,
  ConversationFlowStatus
} from './conversation-flow.types';

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

export interface ConversationFlowSessionDocument {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  selectedTopic?: string;
  detectedCategory?: ConversationFlowCategory;
  status: ConversationFlowStatus;
  safetyRiskLevel: ConversationFlowRiskLevel;
  jurisdiction?: string;
  location?: string;
  messageCount: number;
  userTurnCount: number;
  triageOfferedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationFlowMessageDocument {
  _id: Types.ObjectId;
  conversationSessionId: Types.ObjectId;
  role: ConversationFlowMessageRole;
  content: string;
  turnNumber: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationFlowFactsDocument {
  _id: Types.ObjectId;
  conversationSessionId: Types.ObjectId;
  whatHappened?: string;
  whenHappened?: string;
  whereHappened?: string;
  peopleInvolved?: string;
  safetyConcerns?: string;
  evidenceMentioned?: string;
  emotionalState?: string;
  extractedEvents: string[];
  missingInformation: string[];
  timeline: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationFlowTriageDocument {
  _id: Types.ObjectId;
  conversationSessionId: Types.ObjectId;
  likelyCategory: ConversationFlowCategory;
  confidenceScore: number;
  safetyRiskLevel: ConversationFlowRiskLevel;
  reasoningSummary: string;
  matchedLegislationIds: string[];
  matchedKnowledgeSources: unknown[];
  humanReviewRecommended: boolean;
  missingInformation: string[];
  canProceedToRecommendations: boolean;
  matchedResourceTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const conversationFlowSessionSchema = new Schema<ConversationFlowSessionDocument>(
  {
    ...ownerFields,
    selectedTopic: {
      type: String,
      required: false,
      trim: true,
      index: true
    },
    detectedCategory: {
      type: String,
      enum: CONVERSATION_FLOW_CATEGORIES,
      required: false,
      index: true
    },
    status: {
      type: String,
      enum: CONVERSATION_FLOW_STATUSES,
      default: 'active',
      required: true,
      index: true
    },
    safetyRiskLevel: {
      type: String,
      enum: CONVERSATION_FLOW_RISK_LEVELS,
      default: 'low',
      required: true,
      index: true
    },
    jurisdiction: {
      type: String,
      required: false,
      trim: true,
      index: true
    },
    location: {
      type: String,
      required: false,
      trim: true
    },
    messageCount: {
      type: Number,
      default: 0,
      min: 0
    },
    userTurnCount: {
      type: Number,
      default: 0,
      min: 0
    },
    triageOfferedAt: {
      type: Date,
      required: false
    }
  },
  { timestamps: true }
);

conversationFlowSessionSchema.index({ sessionId: 1, createdAt: -1 });
conversationFlowSessionSchema.index({ userId: 1, createdAt: -1 });

const conversationFlowMessageSchema = new Schema<ConversationFlowMessageDocument>(
  {
    conversationSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ConversationFlowSession',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: CONVERSATION_FLOW_MESSAGE_ROLES,
      required: true,
      index: true
    },
    content: {
      type: String,
      required: true,
      trim: true
    },
    turnNumber: {
      type: Number,
      required: true,
      min: 1
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

conversationFlowMessageSchema.index({ conversationSessionId: 1, turnNumber: 1 }, { unique: true });

const conversationFlowFactsSchema = new Schema<ConversationFlowFactsDocument>(
  {
    conversationSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ConversationFlowSession',
      required: true,
      unique: true,
      index: true
    },
    whatHappened: {
      type: String,
      required: false,
      trim: true
    },
    whenHappened: {
      type: String,
      required: false,
      trim: true
    },
    whereHappened: {
      type: String,
      required: false,
      trim: true
    },
    peopleInvolved: {
      type: String,
      required: false,
      trim: true
    },
    safetyConcerns: {
      type: String,
      required: false,
      trim: true
    },
    evidenceMentioned: {
      type: String,
      required: false,
      trim: true
    },
    emotionalState: {
      type: String,
      required: false,
      trim: true
    },
    extractedEvents: {
      type: [String],
      default: []
    },
    missingInformation: {
      type: [String],
      default: []
    },
    timeline: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

const conversationFlowTriageSchema = new Schema<ConversationFlowTriageDocument>(
  {
    conversationSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ConversationFlowSession',
      required: true,
      unique: true,
      index: true
    },
    likelyCategory: {
      type: String,
      enum: CONVERSATION_FLOW_CATEGORIES,
      required: true,
      index: true
    },
    confidenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1
    },
    safetyRiskLevel: {
      type: String,
      enum: CONVERSATION_FLOW_RISK_LEVELS,
      required: true,
      index: true
    },
    reasoningSummary: {
      type: String,
      required: true,
      trim: true
    },
    matchedLegislationIds: {
      type: [String],
      default: []
    },
    matchedKnowledgeSources: {
      type: [Schema.Types.Mixed],
      default: []
    },
    humanReviewRecommended: {
      type: Boolean,
      default: false
    },
    missingInformation: {
      type: [String],
      default: []
    },
    canProceedToRecommendations: {
      type: Boolean,
      default: false
    },
    matchedResourceTypes: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

export const ConversationFlowSessionModel = model<ConversationFlowSessionDocument>(
  'ConversationFlowSession',
  conversationFlowSessionSchema
);

export const ConversationFlowMessageModel = model<ConversationFlowMessageDocument>(
  'ConversationFlowMessage',
  conversationFlowMessageSchema
);

export const ConversationFlowFactsModel = model<ConversationFlowFactsDocument>(
  'ConversationFlowFacts',
  conversationFlowFactsSchema
);

export const ConversationFlowTriageModel = model<ConversationFlowTriageDocument>(
  'ConversationFlowTriage',
  conversationFlowTriageSchema
);
