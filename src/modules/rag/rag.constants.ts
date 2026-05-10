export const RAG_SOURCE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'expired',
  'archived'
] as const;

export const RAG_SOURCE_CATEGORIES = [
  'internal_product_rule',
  'official_legal_source',
  'official_support_source',
  'admin_content'
] as const;

export const RAG_JURISDICTIONS = [
  'Cth',
  'NSW',
  'VIC',
  'QLD',
  'SA',
  'WA',
  'TAS',
  'NT',
  'ACT',
  'AU',
  'Global',
  'Internal'
] as const;

export const RAG_TOPICS = [
  'discrimination',
  'racial_hatred',
  'online_safety',
  'scam',
  'privacy',
  'workplace',
  'dv',
  'evidence',
  'support',
  'safespeak_policy',
  'consent',
  'crisis',
  'education',
  'other'
] as const;

export const RAG_SOURCE_TYPES = [
  'Act',
  'Regulation',
  'Guideline',
  'Form',
  'Decision',
  'Report',
  'Policy',
  'ProductRequirement',
  'SupportResource',
  'FAQ',
  'WebPage'
] as const;

export const RAG_INGESTION_STATUSES = [
  'metadata_only',
  'fetched',
  'chunked',
  'embedded',
  'failed'
] as const;

export const RAG_ACTIONS = {
  search: 'rag.search',
  answer: 'rag.answer',
  sourceCreate: 'rag.knowledge_source.create',
  sourceUpdate: 'rag.knowledge_source.update',
  sourceDelete: 'rag.knowledge_source.delete',
  sourceIngest: 'rag.knowledge_source.ingest',
  sourceApprove: 'rag.knowledge_source.approve',
  sourceReject: 'rag.knowledge_source.reject',
  sourceReindex: 'rag.knowledge_source.reindex'
} as const;

export const DEFAULT_RAG_TOP_K = 5;
export const RAG_CHUNK_SIZE = 1200;
export const RAG_CHUNK_OVERLAP = 150;
