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

export const RAG_OFFICIAL_SOURCE_HOSTS = [
  'legislation.gov.au',
  'austlii.edu.au',
  'humanrights.gov.au',
  'ahrc.gov.au',
  'esafety.gov.au',
  'oaic.gov.au',
  'accc.gov.au',
  'scamwatch.gov.au',
  'cyber.gov.au',
  'acma.gov.au',
  'asic.gov.au',
  'fairwork.gov.au',
  'fwc.gov.au',
  'homeaffairs.gov.au',
  'nsw.gov.au',
  'agd.nsw.gov.au',
  'police.nsw.gov.au',
  'legislation.nsw.gov.au',
  'vic.gov.au',
  'legislation.vic.gov.au',
  'veohrc.vic.gov.au',
  'vcat.vic.gov.au',
  'qld.gov.au',
  'legislation.qld.gov.au',
  'adcq.qld.gov.au',
  'courts.qld.gov.au',
  'sa.gov.au',
  'legislation.sa.gov.au',
  'equalopportunity.sa.gov.au',
  'wa.gov.au',
  'legislation.wa.gov.au',
  'equalopportunity.wa.gov.au',
  'tas.gov.au',
  'legislation.tas.gov.au',
  'equalopportunity.tas.gov.au',
  'nt.gov.au',
  'legislation.nt.gov.au',
  'act.gov.au',
  'legislation.act.gov.au',
  '1800respect.org.au',
  'legalaid.nsw.gov.au',
  'legalaid.vic.gov.au',
  'legalaid.qld.gov.au',
  'lsc.sa.gov.au',
  'legalaid.wa.gov.au',
  'legalaid.tas.gov.au'
] as const;

export const RAG_GOVERNED_SOURCE_CATEGORIES = [
  'official_legal_source',
  'official_support_source'
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
  sourceRefresh: 'rag.knowledge_source.refresh',
  sourceApprove: 'rag.knowledge_source.approve',
  sourceReject: 'rag.knowledge_source.reject',
  sourceReindex: 'rag.knowledge_source.reindex'
} as const;

export const DEFAULT_RAG_TOP_K = 5;
export const RAG_CHUNK_SIZE = 1200;
export const RAG_CHUNK_OVERLAP = 150;
