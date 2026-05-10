import type {
  RAG_INGESTION_STATUSES,
  RAG_JURISDICTIONS,
  RAG_SOURCE_CATEGORIES,
  RAG_SOURCE_STATUSES,
  RAG_SOURCE_TYPES,
  RAG_TOPICS
} from './rag.constants';

export type RagSourceStatus = (typeof RAG_SOURCE_STATUSES)[number];
export type RagSourceType = (typeof RAG_SOURCE_TYPES)[number];
export type RagSourceCategory = (typeof RAG_SOURCE_CATEGORIES)[number];
export type RagJurisdiction = (typeof RAG_JURISDICTIONS)[number];
export type RagTopic = (typeof RAG_TOPICS)[number];
export type RagIngestionStatus = (typeof RAG_INGESTION_STATUSES)[number];

export interface RagOwner {
  userId?: string;
  sessionId?: string;
}

export interface RagSearchResult {
  chunkId: string;
  sourceId: string;
  title: string;
  publisher: string;
  sourceCategory: RagSourceCategory;
  sourceType: RagSourceType;
  jurisdiction: RagJurisdiction;
  topic: RagTopic;
  sectionRef?: string;
  lastUpdated?: Date;
  citationUrl?: string;
  text: string;
  score?: number;
  metadata: Record<string, unknown>;
}

export interface RagServiceContext {
  owner: RagOwner;
  actorType?: 'user' | 'admin' | 'anonymous_session';
  ip?: string;
  userAgent?: string;
}
