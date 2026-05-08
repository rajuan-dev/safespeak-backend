export const RAG_SOURCE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'archived'
] as const;

export const RAG_SOURCE_TYPES = ['policy', 'service_directory', 'legal_info', 'safety_resource'] as const;

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
