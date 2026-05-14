import { AdminTaxonomyModel } from '@modules/admin/admin.model';
import type { AdminTaxonomyDocument } from '@modules/admin/admin.model';
import type { AdminTaxonomyType } from '@modules/admin/admin.types';
import {
  SAFE_SPEAK_COMMUNITY_PROFILES,
  SAFE_SPEAK_CULTURAL_PROFILES,
  SAFE_SPEAK_FAITH_PROFILES,
  SAFE_SPEAK_INCIDENT_TYPES,
  SAFE_SPEAK_PRIORITY_LANGUAGE_OPTIONS,
  SAFE_SPEAK_SUPPORT_NEEDS
} from '@modules/scope/scope.constants';

type ProfileCultureGroup = 'cultural' | 'faith' | 'community';

export type PublicTaxonomyRecord = {
  type: AdminTaxonomyType;
  key: string;
  label: string;
  description?: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
};

export type PublicTaxonomyCatalog = {
  incidentTypes: PublicTaxonomyRecord[];
  supportNeeds: PublicTaxonomyRecord[];
  languages: PublicTaxonomyRecord[];
  cultures: PublicTaxonomyRecord[];
};

const QUICK_START_INCIDENT_TYPES = [
  { key: 'domestic_violence', label: 'Domestic Violence' },
  { key: 'racial_abuse', label: 'Racial Abuse' },
  { key: 'migrant_challenges', label: 'Migrant Challenges' }
] as const;

const normalizeComparable = (value: string): string => value.trim().toLowerCase();

export const normalizeTaxonomyKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const toTitleLabel = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const taxonomyRecord = (
  type: AdminTaxonomyType,
  key: string,
  label: string,
  metadata: Record<string, unknown> = {}
): PublicTaxonomyRecord => ({
  type,
  key,
  label,
  isActive: true,
  metadata: {
    source: 'scope_default',
    ...metadata
  }
});

const defaultIncidentTypeRecords = [
  ...SAFE_SPEAK_INCIDENT_TYPES.map((key) =>
    taxonomyRecord('incident_type', key, toTitleLabel(key))
  ),
  ...QUICK_START_INCIDENT_TYPES.map(({ key, label }) =>
    taxonomyRecord('incident_type', key, label)
  )
];

const defaultSupportNeedRecords = SAFE_SPEAK_SUPPORT_NEEDS.map((key) =>
  taxonomyRecord('support_need', key, toTitleLabel(key))
);

const defaultLanguageRecords = SAFE_SPEAK_PRIORITY_LANGUAGE_OPTIONS.map(
  ({ code, label, region, priority }) =>
    taxonomyRecord('language', code, label, {
      region,
      priority
    })
);

const profileRecord = (
  label: string,
  profileGroup: ProfileCultureGroup
): PublicTaxonomyRecord =>
  taxonomyRecord('culture', `${profileGroup}_${normalizeTaxonomyKey(label)}`, label, {
    profileGroup
  });

const defaultCultureRecords = [
  ...SAFE_SPEAK_CULTURAL_PROFILES.map((label) => profileRecord(label, 'cultural')),
  ...SAFE_SPEAK_FAITH_PROFILES.map((label) => profileRecord(label, 'faith')),
  ...SAFE_SPEAK_COMMUNITY_PROFILES.map((label) => profileRecord(label, 'community'))
];

export const DEFAULT_TAXONOMY_RECORDS: PublicTaxonomyRecord[] = [
  ...defaultIncidentTypeRecords,
  ...defaultSupportNeedRecords,
  ...defaultLanguageRecords,
  ...defaultCultureRecords
];

const toPublicTaxonomyRecord = (taxonomy: AdminTaxonomyDocument): PublicTaxonomyRecord => ({
  type: taxonomy.type,
  key: taxonomy.key,
  label: taxonomy.label,
  description: taxonomy.description,
  isActive: taxonomy.isActive,
  metadata: taxonomy.metadata ?? {}
});

const mergeTaxonomyRecords = (
  type: AdminTaxonomyType,
  fallbackRecords: PublicTaxonomyRecord[],
  adminRecords: PublicTaxonomyRecord[]
): PublicTaxonomyRecord[] => {
  const records = new Map<string, PublicTaxonomyRecord>();

  fallbackRecords
    .filter((record) => record.type === type)
    .forEach((record) => {
      records.set(record.key, record);
    });

  adminRecords
    .filter((record) => record.type === type)
    .forEach((record) => {
      if (record.isActive) {
        records.set(record.key, record);
        return;
      }

      records.delete(record.key);
    });

  return Array.from(records.values());
};

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  values.forEach((value) => {
    const trimmed = value.trim();
    const key = normalizeComparable(trimmed);

    if (!trimmed || seen.has(key)) {
      return;
    }

    seen.add(key);
    unique.push(trimmed);
  });

  return unique;
};

const readMetadataString = (
  metadata: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  const value = metadata[key];

  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

const isProfileCultureGroup = (value: unknown): value is ProfileCultureGroup =>
  value === 'cultural' || value === 'faith' || value === 'community';

const defaultFaithLabels = new Set(
  SAFE_SPEAK_FAITH_PROFILES.map((label) => normalizeComparable(label))
);
const defaultCommunityLabels = new Set(
  SAFE_SPEAK_COMMUNITY_PROFILES.map((label) => normalizeComparable(label))
);

const getCultureProfileGroup = (record: PublicTaxonomyRecord): ProfileCultureGroup => {
  const metadataGroup = record.metadata.profileGroup;

  if (isProfileCultureGroup(metadataGroup)) {
    return metadataGroup;
  }

  const normalizedKey = normalizeTaxonomyKey(record.key);
  const normalizedLabel = normalizeComparable(record.label);

  if (normalizedKey.startsWith('faith_') || defaultFaithLabels.has(normalizedLabel)) {
    return 'faith';
  }

  if (normalizedKey.startsWith('community_') || defaultCommunityLabels.has(normalizedLabel)) {
    return 'community';
  }

  return 'cultural';
};

const getTaxonomyUsage = (type: AdminTaxonomyType): string => {
  if (type === 'incident_type') {
    return 'report_classification';
  }

  if (type === 'support_need') {
    return 'support_recommendation';
  }

  if (type === 'language') {
    return 'language_access';
  }

  return 'profile_context';
};

const getTaxonomyAnalyticsDimension = (type: AdminTaxonomyType): string => {
  if (type === 'incident_type') {
    return 'incidentType';
  }

  if (type === 'support_need') {
    return 'supportNeed';
  }

  if (type === 'language') {
    return 'language';
  }

  return 'profileContext';
};

export const buildTaxonomyMetadata = (input: {
  type: AdminTaxonomyType;
  key: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> => {
  const metadata = input.metadata ?? {};
  const normalizedKey = normalizeTaxonomyKey(input.key);
  const generatedMetadata: Record<string, unknown> = {
    source: 'admin_created',
    taxonomyType: input.type,
    normalizedKey,
    usage: getTaxonomyUsage(input.type),
    analyticsDimension: getTaxonomyAnalyticsDimension(input.type),
    hasDescription: Boolean(input.description?.trim())
  };

  if (input.type === 'language') {
    generatedMetadata.region = readMetadataString(metadata, 'region', 'Custom');
    generatedMetadata.priority = readMetadataString(metadata, 'priority', 'admin');
  }

  if (input.type === 'culture') {
    generatedMetadata.profileGroup = getCultureProfileGroup({
      type: input.type,
      key: input.key,
      label: input.label,
      description: input.description,
      isActive: true,
      metadata
    });
  }

  return {
    ...generatedMetadata,
    ...metadata
  };
};

export const getTaxonomyCatalog = async (): Promise<PublicTaxonomyCatalog> => {
  const adminTaxonomies = await AdminTaxonomyModel.find({
    deletedAt: { $exists: false }
  })
    .sort({ type: 1, label: 1 })
    .lean<AdminTaxonomyDocument[]>();
  const adminRecords = adminTaxonomies.map(toPublicTaxonomyRecord);

  return {
    incidentTypes: mergeTaxonomyRecords(
      'incident_type',
      DEFAULT_TAXONOMY_RECORDS,
      adminRecords
    ),
    supportNeeds: mergeTaxonomyRecords('support_need', DEFAULT_TAXONOMY_RECORDS, adminRecords),
    languages: mergeTaxonomyRecords('language', DEFAULT_TAXONOMY_RECORDS, adminRecords),
    cultures: mergeTaxonomyRecords('culture', DEFAULT_TAXONOMY_RECORDS, adminRecords)
  };
};

export const toProfileLanguageOptions = (
  languages: PublicTaxonomyRecord[]
): Array<{ code: string; label: string }> =>
  languages.map((record) => ({
    code: record.key,
    label: record.label
  }));

export const toScopeLanguageOptions = (
  languages: PublicTaxonomyRecord[]
): Array<{ code: string; label: string; region: string; priority: string }> =>
  languages.map((record) => ({
    code: record.key,
    label: record.label,
    region: readMetadataString(record.metadata, 'region', 'Custom'),
    priority: readMetadataString(record.metadata, 'priority', 'admin')
  }));

export const getProfileCultureLabels = (
  cultures: PublicTaxonomyRecord[],
  profileGroup: ProfileCultureGroup
): string[] =>
  uniqueStrings(
    cultures
      .filter((record) => getCultureProfileGroup(record) === profileGroup)
      .map((record) => record.label)
  );

export const getProfileLanguageOptions = async (): Promise<
  Array<{ code: string; label: string }>
> => {
  const { languages } = await getTaxonomyCatalog();

  return toProfileLanguageOptions(languages);
};

export const getScopeLanguageOptions = async (): Promise<
  Array<{ code: string; label: string; region: string; priority: string }>
> => {
  const { languages } = await getTaxonomyCatalog();

  return toScopeLanguageOptions(languages);
};

export const getCulturalProfileOptions = async (): Promise<string[]> => {
  const { cultures } = await getTaxonomyCatalog();

  return getProfileCultureLabels(cultures, 'cultural');
};

export const getFaithProfileOptions = async (): Promise<string[]> => {
  const { cultures } = await getTaxonomyCatalog();

  return getProfileCultureLabels(cultures, 'faith');
};

export const getCommunityProfileOptions = async (): Promise<string[]> => {
  const { cultures } = await getTaxonomyCatalog();

  return getProfileCultureLabels(cultures, 'community');
};
