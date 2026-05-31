import { Schema, model, type Types } from 'mongoose';

import {
  RAG_INGESTION_STATUSES,
  RAG_JURISDICTIONS,
  RAG_SOURCE_CATEGORIES,
  RAG_SOURCE_STATUSES,
  RAG_SOURCE_TYPES,
  RAG_TOPICS
} from './rag.constants';
import type {
  RagJurisdiction,
  RagSourceCategory,
  RagIngestionStatus,
  RagSourceStatus,
  RagSourceType,
  RagTopic
} from './rag.types';

export interface RagKnowledgeSourceMetadata {
  adminCategory?: string;
  constitutionalBasis?: string;
  legislationTags?: string[];
  actName?: string;
  actNumber?: string;
  legislationType?: string;
  country?: string;
  state?: string;
  effectiveDate?: string;
  version?: number | string;
  detectedLegalType?: string;
  detectedActNames?: string[];
  detectedSectionRefs?: string[];
  detectedConstitutionalMentions?: string[];
  detectedCourts?: string[];
  extractedPageCount?: number;
  extractionStatus?: string;
  processingStage?: string;
  processingError?: string;
  pineconeIndexedAt?: string;
  pineconeNamespace?: string;
  pineconeIndexName?: string;
  indexedChunkCount?: number;
  indexingError?: string;
  searchableAt?: string;
  searchReadinessStatus?:
    | 'not_indexed'
    | 'indexing'
    | 'indexed_pending_search'
    | 'searchable'
    | 'failed';
  [key: string]: unknown;
}

export interface RagChunkMetadata {
  legalSourceType?: string;
  actName?: string;
  sectionNumber?: string;
  sectionHeading?: string;
  part?: string;
  division?: string;
  schedule?: string;
  pageStart?: number;
  pageEnd?: number;
  constitutionalBasis?: string;
  legislationTags?: string[];
  pineconeVectorId?: string;
  pineconeIndexedAt?: string;
  embeddingStatus?: 'pending' | 'indexed' | 'failed';
  embeddingError?: string;
  [key: string]: unknown;
}

export interface RagKnowledgeSourceDocument {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  sourceCategory: RagSourceCategory;
  jurisdiction: RagJurisdiction;
  topic: RagTopic;
  sourceType: RagSourceType;
  language: string;
  url?: string;
  localFilePath?: string;
  publisher: string;
  licenseStatus: string;
  lastUpdated?: Date;
  lastVerifiedAt?: Date;
  nextReviewAt?: Date;
  nextRefreshAt?: Date;
  legalReviewed: boolean;
  legalReviewedBy?: Types.ObjectId;
  legalReviewedAt?: Date;
  reviewNotes?: string;
  status: RagSourceStatus;
  ingestionStatus?: RagIngestionStatus;
  ingestionError?: string;
  fetchedAt?: Date;
  sha256Hash?: string;
  version: number;
  rawText?: string;
  metadata: RagKnowledgeSourceMetadata;
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
  sourceCategory: RagSourceCategory;
  jurisdiction: RagJurisdiction;
  topic: RagTopic;
  sectionRef?: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
  tokenCount: number;
  citationLabel: string;
  citationUrl?: string;
  metadata: RagChunkMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const ragKnowledgeSourceSchema = new Schema<RagKnowledgeSourceDocument>(
  {
    title: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: false, trim: true },
    sourceCategory: { type: String, enum: RAG_SOURCE_CATEGORIES, required: true, index: true },
    sourceType: { type: String, enum: RAG_SOURCE_TYPES, required: true, index: true },
    jurisdiction: {
      type: String,
      enum: RAG_JURISDICTIONS,
      required: true,
      trim: true,
      index: true
    },
    topic: { type: String, enum: RAG_TOPICS, required: true, index: true },
    language: { type: String, required: true, default: 'en', index: true },
    url: { type: String, required: false, trim: true },
    localFilePath: { type: String, required: false, trim: true },
    publisher: { type: String, required: true, trim: true },
    licenseStatus: { type: String, required: true, trim: true },
    lastUpdated: { type: Date, required: false, index: true },
    lastVerifiedAt: { type: Date, required: false, index: true },
    nextReviewAt: { type: Date, required: false },
    nextRefreshAt: { type: Date, required: false, index: true },
    legalReviewed: { type: Boolean, required: true, default: false, index: true },
    legalReviewedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    legalReviewedAt: { type: Date, required: false },
    reviewNotes: { type: String, required: false, trim: true },
    status: {
      type: String,
      enum: RAG_SOURCE_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    ingestionStatus: { type: String, enum: RAG_INGESTION_STATUSES, required: false, index: true },
    ingestionError: { type: String, required: false },
    fetchedAt: { type: Date, required: false },
    sha256Hash: { type: String, required: false, index: true },
    version: { type: Number, required: true, default: 1 },
    rawText: { type: String, required: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    approvedAt: { type: Date, required: false },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    rejectedAt: { type: Date, required: false },
    rejectionReason: { type: String, required: false },
    ingestedAt: { type: Date, required: false },
    deletedAt: { type: Date, required: false }
  },
  { timestamps: true }
);

const ragChunkSchema = new Schema<RagChunkDocument>(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'RagKnowledgeSource',
      required: true,
      index: true
    },
    sourceCategory: { type: String, enum: RAG_SOURCE_CATEGORIES, required: true, index: true },
    jurisdiction: { type: String, enum: RAG_JURISDICTIONS, required: true, index: true },
    topic: { type: String, enum: RAG_TOPICS, required: true, index: true },
    sectionRef: { type: String, required: false, trim: true },
    chunkIndex: { type: Number, required: true, min: 0 },
    chunkText: { type: String, required: true },
    embedding: { type: [Number], required: true },
    tokenCount: { type: Number, required: true, min: 0 },
    citationLabel: { type: String, required: true, trim: true },
    citationUrl: { type: String, required: false, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

ragChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
ragChunkSchema.index({ sourceCategory: 1, jurisdiction: 1, topic: 1 });

export const RagKnowledgeSourceModel = model<RagKnowledgeSourceDocument>(
  'RagKnowledgeSource',
  ragKnowledgeSourceSchema
);

export const RagChunkModel = model<RagChunkDocument>('RagChunk', ragChunkSchema);
