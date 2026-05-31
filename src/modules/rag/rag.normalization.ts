import type { RagKnowledgeSourceMetadata } from './rag.model';
import type { CreateKnowledgeSourceInput, RefreshKnowledgeSourceInput, UpdateKnowledgeSourceInput } from './rag.schema';
import type { RagSourceCategory, RagTopic } from './rag.types';

const sourceCategoryAliases: Record<string, RagSourceCategory> = {
  legislation: 'official_legal_source',
  legal: 'official_legal_source',
  regulation: 'official_legal_source',
  regulations: 'official_legal_source',
  official_legal_source: 'official_legal_source',
  support: 'official_support_source',
  resources: 'official_support_source',
  official_support_source: 'official_support_source',
  scam_pattern: 'admin_content',
  scam_patterns: 'admin_content',
  admin_content: 'admin_content',
  internal: 'internal_product_rule',
  internal_product_rule: 'internal_product_rule'
};

const topicAliases: Record<string, RagTopic> = {
  domestic_violence: 'dv',
  dv: 'dv',
  racial_abuse: 'racial',
  racial: 'racial',
  cyber_scam: 'scam',
  scam: 'scam',
  scamshield: 'scam',
  migrant_challenges: 'migrant',
  migrant: 'migrant',
  support: 'support',
  resources: 'support',
  local_intelligence: 'local_intelligence',
  smart_dialler: 'smart_dialler'
};

const adminCategoryAliases: Record<string, string> = {
  legislation: 'Legislation',
  support: 'Support',
  resources: 'Support',
  regulation: 'Regulation',
  regulations: 'Regulation',
  scam_pattern: 'Scam Pattern',
  scam_patterns: 'Scam Pattern',
  scam: 'Scam Pattern'
};

const normalizeLookupKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[-\s]+/g, '_');

export const normalizeSourceCategoryValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = normalizeLookupKey(value);

  return sourceCategoryAliases[normalizedKey] ?? normalizedKey;
};

export const normalizeTopicValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = normalizeLookupKey(value);

  return topicAliases[normalizedKey] ?? normalizedKey;
};

export const normalizeAdminCategoryValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = normalizeLookupKey(value);

  return adminCategoryAliases[normalizedKey] ?? value.trim();
};

type KnowledgeSourceInputLike =
  | CreateKnowledgeSourceInput
  | UpdateKnowledgeSourceInput
  | Pick<RefreshKnowledgeSourceInput, 'metadata'>;

export const normalizeKnowledgeSourceMetadata = (
  metadata: Record<string, unknown> | undefined
): RagKnowledgeSourceMetadata | undefined => {
  if (!metadata) {
    return metadata;
  }

  return {
    ...metadata,
    adminCategory: normalizeAdminCategoryValue(metadata.adminCategory) as string | undefined
  };
};

export const normalizeKnowledgeSourceInput = <T extends KnowledgeSourceInputLike>(input: T): T => {
  const normalized = { ...input } as T & {
    sourceCategory?: unknown;
    topic?: unknown;
    metadata?: Record<string, unknown>;
  };

  if ('sourceCategory' in normalized) {
    normalized.sourceCategory = normalizeSourceCategoryValue(normalized.sourceCategory);
  }

  if ('topic' in normalized) {
    normalized.topic = normalizeTopicValue(normalized.topic);
  }

  if ('metadata' in normalized) {
    normalized.metadata = normalizeKnowledgeSourceMetadata(normalized.metadata);
  }

  return normalized;
};

