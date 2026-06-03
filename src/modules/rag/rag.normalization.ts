import type { RagKnowledgeSourceMetadata } from './rag.model';
import type { CreateKnowledgeSourceInput, RefreshKnowledgeSourceInput, UpdateKnowledgeSourceInput } from './rag.schema';
import type {
  RagLegalDomain,
  RagPathwayCategory,
  RagSourceCategory,
  RagStateOrTerritory,
  RagTopic
} from './rag.types';

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

const stateOrTerritoryAliases: Record<string, RagStateOrTerritory> = {
  au: 'AU',
  australia: 'AU',
  commonwealth: 'FEDERAL',
  federal: 'FEDERAL',
  nsw: 'NSW',
  vic: 'VIC',
  qld: 'QLD',
  wa: 'WA',
  sa: 'SA',
  tas: 'TAS',
  act: 'ACT',
  nt: 'NT'
};

const legalDomainAliases: Record<string, RagLegalDomain> = {
  criminal: 'criminal_law',
  criminal_law: 'criminal_law',
  civil: 'civil_law',
  civil_law: 'civil_law',
  discrimination: 'discrimination',
  workplace: 'workplace',
  domestic_family_violence: 'domestic_family_violence',
  domestic_violence: 'domestic_family_violence',
  online_safety: 'online_safety',
  online_abuse: 'online_safety',
  scam: 'scam_fraud',
  scam_fraud: 'scam_fraud',
  privacy: 'privacy',
  migration: 'migration',
  housing: 'housing',
  consumer: 'consumer',
  police_reporting: 'police_reporting',
  support: 'support_service',
  support_service: 'support_service'
};

const pathwayCategoryAliases: Record<string, RagPathwayCategory> = {
  reporting: 'reporting',
  support: 'support',
  legal_information: 'legal_information',
  evidence: 'evidence_guidance',
  evidence_guidance: 'evidence_guidance',
  safety: 'safety_planning',
  safety_planning: 'safety_planning',
  scam: 'scam_response',
  scam_response: 'scam_response',
  workplace: 'workplace_options',
  workplace_options: 'workplace_options',
  online_abuse: 'online_abuse',
  online_safety: 'online_abuse',
  domestic_violence: 'domestic_family_violence',
  domestic_family_violence: 'domestic_family_violence'
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

export const normalizeStateOrTerritoryValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = normalizeLookupKey(value);
  return stateOrTerritoryAliases[normalizedKey] ?? value.trim().toUpperCase();
};

export const normalizeLegalDomainValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = normalizeLookupKey(value);
  return legalDomainAliases[normalizedKey] ?? normalizedKey;
};

export const normalizePathwayCategoryValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedKey = normalizeLookupKey(value);
  return pathwayCategoryAliases[normalizedKey] ?? normalizedKey;
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
    adminCategory: normalizeAdminCategoryValue(metadata.adminCategory) as string | undefined,
    stateOrTerritory: normalizeStateOrTerritoryValue(metadata.stateOrTerritory) as
      | string
      | undefined,
    legalDomain: normalizeLegalDomainValue(metadata.legalDomain) as string | undefined,
    pathwayCategory: normalizePathwayCategoryValue(metadata.pathwayCategory) as
      | string
      | undefined
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

  if ('stateOrTerritory' in normalized) {
    normalized.stateOrTerritory = normalizeStateOrTerritoryValue(
      normalized.stateOrTerritory
    ) as typeof normalized.stateOrTerritory;
  }

  if ('legalDomain' in normalized) {
    normalized.legalDomain = normalizeLegalDomainValue(
      normalized.legalDomain
    ) as typeof normalized.legalDomain;
  }

  if ('pathwayCategory' in normalized) {
    normalized.pathwayCategory = normalizePathwayCategoryValue(
      normalized.pathwayCategory
    ) as typeof normalized.pathwayCategory;
  }

  if ('metadata' in normalized) {
    normalized.metadata = normalizeKnowledgeSourceMetadata(normalized.metadata);
  }

  return normalized;
};
