import type {
  RAG_INDEX_SYNC_STATUSES,
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

export type RagSourceStatus = (typeof RAG_SOURCE_STATUSES)[number];
export type RagSourceType = (typeof RAG_SOURCE_TYPES)[number];
export type RagSourceCategory = (typeof RAG_SOURCE_CATEGORIES)[number];
export type RagJurisdiction = (typeof RAG_JURISDICTIONS)[number];
export type RagTopic = (typeof RAG_TOPICS)[number];
export type RagIngestionStatus = (typeof RAG_INGESTION_STATUSES)[number];
export type RagStateOrTerritory = (typeof RAG_STATE_OR_TERRITORIES)[number];
export type RagLegalDomain = (typeof RAG_LEGAL_DOMAINS)[number];
export type RagPathwayCategory = (typeof RAG_PATHWAY_CATEGORIES)[number];
export type RagSourceReliability = (typeof RAG_SOURCE_RELIABILITIES)[number];
export type RagIndexSyncStatus = (typeof RAG_INDEX_SYNC_STATUSES)[number];

export interface RagOwner {
  userId?: string;
  sessionId?: string;
}

export interface RagSearchResult {
  chunkId: string;
  sourceId: string;
  title: string;
  sourceTitle: string;
  publisher: string;
  sourceAuthority: string;
  sourceCategory: RagSourceCategory;
  sourceType: RagSourceType;
  jurisdiction: RagJurisdiction;
  stateOrTerritory?: RagStateOrTerritory;
  pathwayCategory?: RagPathwayCategory;
  legalDomain?: RagLegalDomain;
  topic: RagTopic;
  legislationName?: string;
  sectionRef?: string;
  sectionTitle?: string;
  lastUpdated?: Date;
  citationUrl?: string;
  text: string;
  score?: number;
  metadata: Record<string, unknown>;
}

export interface RagLegalAwarenessCard {
  title: string;
  body: string;
  sourceRequirement: string;
}

export interface RagLegalAwareness {
  jurisdiction: 'NSW';
  topic: 'racial_abuse' | 'migrant_challenges';
  informationOnly: true;
  sourceStatus: 'approved_sources_used' | 'insufficient_approved_sources';
  keyPoints: string[];
  pathwayCards: RagLegalAwarenessCard[];
  citationPolicy: string;
}

export interface RagServiceContext {
  owner: RagOwner;
  actorType?: 'user' | 'admin' | 'anonymous_session';
  ip?: string;
  userAgent?: string;
}

export type RagKnowledgeReadinessStatus = 'ready' | 'ready_with_gaps' | 'not_ready';
export type RagVectorIndexReadinessStatus = 'ready' | 'missing' | 'unavailable' | 'error';

export interface RagVectorIndexReadiness {
  status: RagVectorIndexReadinessStatus;
  indexName: string;
  collectionName: string;
  embeddingField: 'embedding';
  embeddingModel: string;
  expectedDimensions?: number;
  message: string;
  definition?: unknown;
}

export interface RagKnowledgeReadinessConfiguration {
  openAiApiKeyConfigured: boolean;
  embeddingModel: string;
  vectorIndex: RagVectorIndexReadiness;
  retrievalReady: boolean;
}

export interface RagKnowledgeReadinessSummary {
  readinessStatus: RagKnowledgeReadinessStatus;
  readyForPublicLegalRag: boolean;
  retrievalConfigurationReady: boolean;
  totalOfficialSources: number;
  eligibleCitationSources: number;
  eligibleLegalSources: number;
  approvedCurrentSources: number;
  legalReviewedSources: number;
  pendingReviewSources: number;
  expiredRefreshSources: number;
  metadataOnlySources: number;
  failedIngestionSources: number;
  blockedSources: number;
}

export interface RagKnowledgeReadinessCoverageCell {
  sourceCategory: Extract<RagSourceCategory, 'official_legal_source' | 'official_support_source'>;
  jurisdiction: RagJurisdiction;
  topic: RagTopic;
  totalSources: number;
  eligibleSources: number;
  approvedSources: number;
  pendingReviewSources: number;
  needsLegalReviewSources: number;
  needsRefreshSources: number;
  metadataOnlySources: number;
  failedIngestionSources: number;
  noChunkSources: number;
}

export interface RagKnowledgeReadinessBlocker {
  code:
    | 'not_approved'
    | 'legal_review_missing'
    | 'refresh_due_or_missing'
    | 'not_embedded'
    | 'no_chunks'
    | 'official_url_missing_or_unapproved'
    | 'ingestion_failed'
    | 'metadata_only_needs_text'
    | 'openai_api_key_missing'
    | 'vector_index_missing'
    | 'vector_search_unavailable'
    | 'vector_index_check_failed';
  label: string;
  count: number;
  sourceIds: string[];
  sourceTitles: string[];
}

export interface RagKnowledgeSourceReadiness {
  generatedAt: string;
  summary: RagKnowledgeReadinessSummary;
  configuration: RagKnowledgeReadinessConfiguration;
  coverage: RagKnowledgeReadinessCoverageCell[];
  blockers: RagKnowledgeReadinessBlocker[];
}
