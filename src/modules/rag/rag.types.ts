import type { RAG_SOURCE_STATUSES, RAG_SOURCE_TYPES } from './rag.constants';

export type RagSourceStatus = (typeof RAG_SOURCE_STATUSES)[number];
export type RagSourceType = (typeof RAG_SOURCE_TYPES)[number];

export interface RagOwner {
  userId?: string;
  sessionId?: string;
}

export interface RagSearchResult {
  chunkId: string;
  sourceId: string;
  title: string;
  sourceType: RagSourceType;
  text: string;
  score?: number;
  metadata: Record<string, unknown>;
}

export interface RagServiceContext {
  owner: RagOwner;
  ip?: string;
  userAgent?: string;
}
