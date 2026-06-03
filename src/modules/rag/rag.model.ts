import { Schema, model, type Types } from 'mongoose';

import {
  RAG_INGESTION_STATUSES,
  RAG_JURISDICTIONS,
  RAG_LEGAL_DOMAINS,
  RAG_PATHWAY_CATEGORIES,
  RAG_SOURCE_CATEGORIES,
  RAG_SOURCE_RELIABILITIES,
  RAG_SOURCE_STATUSES,
  RAG_SOURCE_TYPES,
  RAG_STATE_OR_TERRITORIES,
  RAG_TOPICS
} from './rag.constants';
import type {
  RagIndexSyncStatus,
  RagJurisdiction,
  RagLegalDomain,
  RagOcrProgress,
  RagPathwayCategory,
  RagSourceCategory,
  RagIngestionStatus,
  RagSourceReliability,
  RagSourceStatus,
  RagSourceType,
  RagStateOrTerritory,
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
  extractionMethod?: 'text' | 'ocr' | 'manual' | 'url';
  extractionStatus?: string;
  ocrProvider?: string;
  ocrAverageConfidence?: number;
  ocrPageCount?: number;
  ocrWarnings?: string[];
  ocrReviewRequired?: boolean;
  ocrReviewedAt?: string;
  ocrReviewedBy?: string;
  ocrStatus?:
    | 'not_required'
    | 'required'
    | 'running'
    | 'completed'
    | 'low_confidence'
    | 'failed'
    | 'pending_review'
    | 'reviewed';
  ocrProgress?: RagOcrProgress;
  processingStage?: string;
  processingError?: string;
  pineconeIndexedAt?: string;
  pineconeNamespace?: string;
  pineconeIndexName?: string;
  indexedChunkCount?: number;
  indexingError?: string;
  pineconeIndexed?: boolean;
  pineconeVectorCount?: number;
  mongoChunkCount?: number;
  lastIndexedAt?: string;
  indexSyncStatus?: RagIndexSyncStatus;
  indexSyncError?: string;
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
  extractionMethod?: 'text' | 'ocr' | 'manual' | 'url';
  pageNumber?: number;
  ocrConfidence?: number;
  ocrProvider?: string;
  processingTimeMs?: number;
  ocrPageStatus?: 'completed' | 'failed' | 'skipped' | 'low_confidence';
  constitutionalBasis?: string;
  legislationTags?: string[];
  pineconeVectorId?: string;
  pineconeIndexedAt?: string;
  pineconeIndexed?: boolean;
  embeddingModel?: string;
  pineconeIndex?: string;
  pineconeNamespace?: string;
  embeddingCreatedAt?: string;
  embeddingStatus?: 'pending' | 'indexed' | 'failed';
  embeddingError?: string;
  [key: string]: unknown;
}

export interface RagKnowledgeSourceDocument {
  _id: Types.ObjectId;
  sourceId?: string;
  title: string;
  sourceTitle?: string;
  description?: string;
  sourceCategory: RagSourceCategory;
  sourceAuthority?: string;
  officialUrl?: string;
  country?: string;
  jurisdiction: RagJurisdiction;
  stateOrTerritory?: RagStateOrTerritory;
  pathwayCategory?: RagPathwayCategory;
  legalDomain?: RagLegalDomain;
  topic: RagTopic;
  legislationName?: string;
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
  active: boolean;
  extractionMethod?: 'text' | 'ocr' | 'manual' | 'url';
  ocrProvider?: string;
  ocrAverageConfidence?: number;
  ocrPageCount?: number;
  ocrWarnings?: string[];
  ocrReviewRequired?: boolean;
  ocrReviewedAt?: Date;
  ocrReviewedBy?: Types.ObjectId;
  ocrStatus?:
    | 'not_required'
    | 'required'
    | 'running'
    | 'completed'
    | 'low_confidence'
    | 'failed'
    | 'pending_review'
    | 'reviewed';
  sourceReliability: RagSourceReliability;
  embeddingModel?: string;
  pineconeIndex?: string;
  pineconeNamespace?: string;
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
  sourceTitle?: string;
  sourceCategory: RagSourceCategory;
  sourceAuthority?: string;
  officialUrl?: string;
  country?: string;
  jurisdiction: RagJurisdiction;
  stateOrTerritory?: RagStateOrTerritory;
  pathwayCategory?: RagPathwayCategory;
  legalDomain?: RagLegalDomain;
  topic: RagTopic;
  legislationName?: string;
  sourceType?: RagSourceType;
  sectionRef?: string;
  sectionNumber?: string;
  sectionTitle?: string;
  chunkIndex: number;
  chunkText: string;
  chunkHash?: string;
  embedding: number[];
  embeddingModel?: string;
  pineconeIndex?: string;
  pineconeNamespace?: string;
  pineconeVectorId?: string;
  legalReviewed: boolean;
  active: boolean;
  extractionMethod?: 'text' | 'ocr' | 'manual' | 'url';
  pageNumber?: number;
  ocrConfidence?: number;
  ocrProvider?: string;
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
    sourceId: { type: String, required: false, trim: true, index: true },
    sourceTitle: { type: String, required: false, trim: true },
    description: { type: String, required: false, trim: true },
    sourceCategory: { type: String, enum: RAG_SOURCE_CATEGORIES, required: true, index: true },
    sourceType: { type: String, enum: RAG_SOURCE_TYPES, required: true, index: true },
    sourceAuthority: { type: String, required: false, trim: true },
    officialUrl: { type: String, required: false, trim: true },
    country: { type: String, required: false, trim: true, index: true },
    jurisdiction: {
      type: String,
      enum: RAG_JURISDICTIONS,
      required: true,
      trim: true,
      index: true
    },
    stateOrTerritory: {
      type: String,
      enum: RAG_STATE_OR_TERRITORIES,
      required: false,
      trim: true,
      index: true
    },
    pathwayCategory: {
      type: String,
      enum: RAG_PATHWAY_CATEGORIES,
      required: false,
      trim: true,
      index: true
    },
    legalDomain: {
      type: String,
      enum: RAG_LEGAL_DOMAINS,
      required: false,
      trim: true,
      index: true
    },
    topic: { type: String, enum: RAG_TOPICS, required: true, index: true },
    legislationName: { type: String, required: false, trim: true, index: true },
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
    active: { type: Boolean, required: true, default: true, index: true },
    extractionMethod: {
      type: String,
      enum: ['text', 'ocr', 'manual', 'url'],
      required: false,
      default: 'text'
    },
    ocrProvider: { type: String, required: false, trim: true },
    ocrAverageConfidence: { type: Number, required: false, min: 0, max: 1 },
    ocrPageCount: { type: Number, required: false, min: 0 },
    ocrWarnings: { type: [String], required: false, default: undefined },
    ocrReviewRequired: { type: Boolean, required: false, default: false, index: true },
    ocrReviewedAt: { type: Date, required: false },
    ocrReviewedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    ocrStatus: {
      type: String,
      enum: [
        'not_required',
        'required',
        'running',
        'completed',
        'low_confidence',
        'failed',
        'pending_review',
        'reviewed'
      ],
      required: false,
      default: 'not_required',
      index: true
    },
    sourceReliability: {
      type: String,
      enum: RAG_SOURCE_RELIABILITIES,
      required: true,
      default: 'unknown',
      index: true
    },
    embeddingModel: { type: String, required: false, trim: true },
    pineconeIndex: { type: String, required: false, trim: true },
    pineconeNamespace: { type: String, required: false, trim: true },
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
    sourceTitle: { type: String, required: false, trim: true, index: true },
    sourceCategory: { type: String, enum: RAG_SOURCE_CATEGORIES, required: true, index: true },
    sourceAuthority: { type: String, required: false, trim: true },
    officialUrl: { type: String, required: false, trim: true },
    country: { type: String, required: false, trim: true, index: true },
    jurisdiction: { type: String, enum: RAG_JURISDICTIONS, required: true, index: true },
    stateOrTerritory: {
      type: String,
      enum: RAG_STATE_OR_TERRITORIES,
      required: false,
      trim: true,
      index: true
    },
    pathwayCategory: {
      type: String,
      enum: RAG_PATHWAY_CATEGORIES,
      required: false,
      trim: true,
      index: true
    },
    legalDomain: {
      type: String,
      enum: RAG_LEGAL_DOMAINS,
      required: false,
      trim: true,
      index: true
    },
    topic: { type: String, enum: RAG_TOPICS, required: true, index: true },
    legislationName: { type: String, required: false, trim: true, index: true },
    sourceType: { type: String, enum: RAG_SOURCE_TYPES, required: false, index: true },
    sectionRef: { type: String, required: false, trim: true },
    sectionNumber: { type: String, required: false, trim: true, index: true },
    sectionTitle: { type: String, required: false, trim: true },
    chunkIndex: { type: Number, required: true, min: 0 },
    chunkText: { type: String, required: true },
    chunkHash: { type: String, required: false, trim: true, index: true },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, required: false, trim: true },
    pineconeIndex: { type: String, required: false, trim: true },
    pineconeNamespace: { type: String, required: false, trim: true },
    pineconeVectorId: { type: String, required: false, trim: true, index: true },
    legalReviewed: { type: Boolean, required: true, default: false, index: true },
    active: { type: Boolean, required: true, default: true, index: true },
    extractionMethod: {
      type: String,
      enum: ['text', 'ocr', 'manual', 'url'],
      required: false,
      default: 'text',
      index: true
    },
    pageNumber: { type: Number, required: false, min: 1, index: true },
    ocrConfidence: { type: Number, required: false, min: 0, max: 1 },
    ocrProvider: { type: String, required: false, trim: true, index: true },
    tokenCount: { type: Number, required: true, min: 0 },
    citationLabel: { type: String, required: true, trim: true },
    citationUrl: { type: String, required: false, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

ragChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
ragChunkSchema.index({
  sourceCategory: 1,
  jurisdiction: 1,
  stateOrTerritory: 1,
  topic: 1,
  legalDomain: 1,
  pathwayCategory: 1,
  active: 1
});

export const RagKnowledgeSourceModel = model<RagKnowledgeSourceDocument>(
  'RagKnowledgeSource',
  ragKnowledgeSourceSchema
);

export const RagChunkModel = model<RagChunkDocument>('RagChunk', ragChunkSchema);
