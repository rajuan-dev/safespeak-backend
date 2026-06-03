export interface VectorSearchFilters {
  jurisdiction?: string;
  stateOrTerritory?: string;
  topic?: string;
  legalDomain?: string;
  pathwayCategory?: string;
  sourceCategory?: string;
  sourceType?: string;
  sourceReliability?: string;
  adminCategory?: string;
  status?: string;
  active?: boolean;
  legalReviewed?: boolean;
  sourceIds?: string[];
  legislationTags?: string[];
}

export interface VectorChunkUpsertRecord {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

export interface VectorStoreUpsertParams {
  chunks: VectorChunkUpsertRecord[];
}

export interface VectorStoreSearchParams {
  vector: number[];
  topK: number;
  filters?: VectorSearchFilters;
}

export interface VectorSearchResult {
  chunkId: string;
  sourceId: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorStoreHealth {
  configured: boolean;
  healthy: boolean;
  indexName?: string;
  namespace?: string;
  embeddingModel?: string;
  expectedDimension?: number;
  reachable?: boolean;
  message?: string;
}

export interface VectorStore {
  upsertChunks(params: VectorStoreUpsertParams): Promise<void>;
  search(params: VectorStoreSearchParams): Promise<VectorSearchResult[]>;
  deleteBySource(sourceId: string): Promise<void>;
  deleteByChunkIds(chunkIds: string[]): Promise<void>;
  healthCheck(): Promise<VectorStoreHealth>;
}
