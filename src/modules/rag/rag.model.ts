import { Schema, model, type Types } from 'mongoose';

import { RAG_SOURCE_STATUSES, RAG_SOURCE_TYPES } from './rag.constants';
import type { RagSourceStatus, RagSourceType } from './rag.types';

export interface RagKnowledgeSourceDocument {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  sourceType: RagSourceType;
  jurisdiction?: string;
  language: string;
  url?: string;
  status: RagSourceStatus;
  contentHash?: string;
  rawText?: string;
  metadata: Record<string, unknown>;
  createdBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  ingestedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface RagChunkDocument {
  _id: Types.ObjectId;
  sourceId: Types.ObjectId;
  chunkIndex: number;
  text: string;
  embedding: number[];
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ragKnowledgeSourceSchema = new Schema<RagKnowledgeSourceDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    description: {
      type: String,
      required: false,
      trim: true
    },
    sourceType: {
      type: String,
      enum: RAG_SOURCE_TYPES,
      required: true,
      index: true
    },
    jurisdiction: {
      type: String,
      required: false,
      trim: true,
      index: true
    },
    language: {
      type: String,
      required: true,
      default: 'en',
      index: true
    },
    url: {
      type: String,
      required: false,
      trim: true
    },
    status: {
      type: String,
      enum: RAG_SOURCE_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    contentHash: {
      type: String,
      required: false,
      index: true
    },
    rawText: {
      type: String,
      required: false
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    approvedAt: {
      type: Date,
      required: false
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false
    },
    rejectedAt: {
      type: Date,
      required: false
    },
    rejectionReason: {
      type: String,
      required: false
    },
    ingestedAt: {
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

const ragChunkSchema = new Schema<RagChunkDocument>(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'RagKnowledgeSource',
      required: true,
      index: true
    },
    chunkIndex: {
      type: Number,
      required: true,
      min: 0
    },
    text: {
      type: String,
      required: true
    },
    embedding: {
      type: [Number],
      required: true
    },
    contentHash: {
      type: String,
      required: true,
      index: true
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

ragChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });

export const RagKnowledgeSourceModel = model<RagKnowledgeSourceDocument>(
  'RagKnowledgeSource',
  ragKnowledgeSourceSchema
);

export const RagChunkModel = model<RagChunkDocument>('RagChunk', ragChunkSchema);
