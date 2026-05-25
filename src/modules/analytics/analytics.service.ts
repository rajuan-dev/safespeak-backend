import { randomInt, randomUUID } from 'node:crypto';

import { createAuditLog } from '@modules/audit/audit.service';
import { ReportModel } from '@modules/reports/reports.model';

import { ANALYTICS_ACTIONS } from './analytics.constants';
import type {
  AnalyticsExportQueryInput,
  AnalyticsQueryInput,
  LocalIntelligenceQueryInput
} from './analytics.schema';
import type { AnalyticsServiceContext, PublicAnalyticsServiceContext } from './analytics.types';

const MINIMUM_PUBLIC_CELL_SIZE = 5;
const ANALYTICS_EXPORT_EPSILON = 1;
const ANALYTICS_EXPORT_SENSITIVITY = 1;
const ANALYTICS_EXPORT_MAX_ABSOLUTE_NOISE = 20;
const PUBLIC_LOCAL_INTELLIGENCE_STATUSES = [
  'local_only',
  'ready_for_review',
  'triaged',
  'info_only',
  'pending_submission',
  'submitted',
  'received',
  'closed'
] as const;

type LocalIntelligenceCountCell = {
  count?: number;
  suppressed: boolean;
  label: string;
};

type LocalIntelligenceAreaRow = {
  _id: {
    jurisdiction?: string | null;
    region?: string | null;
  };
  count: number;
};

type LocalIntelligenceNamedRow = {
  _id?: string | null;
  count: number;
};

type AnalyticsBucketRow = {
  _id?: Record<string, string | null> | string | null;
  count: number;
};

type ProtectedAnalyticsCount = {
  count?: number;
  suppressed: boolean;
  label: string;
  noiseApplied: boolean;
};

type ProtectedAnalyticsBucket = {
  _id?: Record<string, string | null> | string | null;
  count?: number;
  suppressed: boolean;
  label: string;
  noiseApplied: boolean;
};

type AnalyticsExportPrivacyCounters = {
  noisyCounts: number;
  suppressedCells: number;
};

const baseMatch = (query: AnalyticsQueryInput): Record<string, unknown> => ({
  'consentSnapshot.use_anonymised_analytics': true,
  deletedAt: {
    $exists: false
  },
  ...(query.from || query.to
    ? {
        createdAt: {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lte: new Date(query.to) } : {})
        }
      }
    : {}),
  ...(query.jurisdiction ? { jurisdiction: query.jurisdiction } : {}),
  ...(query.language ? { language: query.language } : {})
});

const getLocalIntelligenceStartDate = (timeframe: LocalIntelligenceQueryInput['timeframe']) => {
  const now = new Date();

  if (timeframe === '30d') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  if (timeframe === '90d') {
    return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }

  if (timeframe === '12m') {
    return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  }

  return undefined;
};

const publicLocalIntelligenceMatch = (
  query: LocalIntelligenceQueryInput
): Record<string, unknown> => {
  const startDate = getLocalIntelligenceStartDate(query.timeframe);

  return {
    'consentSnapshot.use_anonymised_analytics': true,
    deletedAt: {
      $exists: false
    },
    deletionRequestedAt: {
      $exists: false
    },
    withdrawnAt: {
      $exists: false
    },
    status: {
      $in: PUBLIC_LOCAL_INTELLIGENCE_STATUSES
    },
    ...(startDate ? { createdAt: { $gte: startDate } } : {}),
    ...(query.jurisdiction ? { jurisdiction: query.jurisdiction } : {}),
    ...(query.region ? { lga: query.region } : {}),
    ...(query.category ? { incidentType: query.category } : {})
  };
};

const publicFilterOptionMatch = (
  query: LocalIntelligenceQueryInput,
  omitted: Array<'jurisdiction' | 'region' | 'category'>
): Record<string, unknown> => {
  const nextQuery = {
    ...query,
    ...(omitted.includes('jurisdiction') ? { jurisdiction: undefined } : {}),
    ...(omitted.includes('region') ? { region: undefined } : {}),
    ...(omitted.includes('category') ? { category: undefined } : {})
  };

  return publicLocalIntelligenceMatch(nextQuery);
};

const suppressCount = (count: number): LocalIntelligenceCountCell =>
  count >= MINIMUM_PUBLIC_CELL_SIZE
    ? {
        count,
        suppressed: false,
        label: count.toLocaleString('en-AU')
      }
    : {
        suppressed: true,
        label: `Privacy protected: fewer than ${MINIMUM_PUBLIC_CELL_SIZE}`
      };

const publicCell = (count: number): LocalIntelligenceCountCell => suppressCount(count);

const normalizeDimension = (value: string | null | undefined, fallback: string): string =>
  value?.trim() || fallback;

const secureUnitRandom = (): number => randomInt(1, 1_000_000) / 1_000_001;

export const sampleLaplaceNoise = (
  epsilon = ANALYTICS_EXPORT_EPSILON,
  sensitivity = ANALYTICS_EXPORT_SENSITIVITY,
  rng: () => number = secureUnitRandom
): number => {
  const boundedRandom = Math.min(Math.max(rng(), Number.EPSILON), 1 - Number.EPSILON);
  const centered = boundedRandom - 0.5;
  const scale = sensitivity / epsilon;

  return -scale * Math.sign(centered) * Math.log(1 - 2 * Math.abs(centered));
};

const clampNoise = (noise: number): number =>
  Math.max(
    -ANALYTICS_EXPORT_MAX_ABSOLUTE_NOISE,
    Math.min(ANALYTICS_EXPORT_MAX_ABSOLUTE_NOISE, noise)
  );

export const protectAnalyticsExportCount = (
  count: number,
  options: {
    minimumCellSize?: number;
    epsilon?: number;
    sensitivity?: number;
    rng?: () => number;
  } = {}
): ProtectedAnalyticsCount => {
  const minimumCellSize = options.minimumCellSize ?? MINIMUM_PUBLIC_CELL_SIZE;

  if (count < minimumCellSize) {
    return {
      suppressed: true,
      label: `Privacy protected: fewer than ${minimumCellSize}`,
      noiseApplied: false
    };
  }

  const noise = clampNoise(
    sampleLaplaceNoise(options.epsilon, options.sensitivity, options.rng)
  );
  const noisyCount = Math.max(0, Math.round(count + noise));

  return {
    count: noisyCount,
    suppressed: false,
    label: noisyCount.toLocaleString('en-AU'),
    noiseApplied: true
  };
};

const toThresholdedOptions = (rows: LocalIntelligenceNamedRow[]): string[] =>
  rows
    .filter((row) => row.count >= MINIMUM_PUBLIC_CELL_SIZE)
    .map((row) => normalizeDimension(row._id, 'Unspecified'));

const audit = async (
  context: AnalyticsServiceContext,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: 'admin',
    actorId: context.actor.userId,
    action,
    resourceType: 'system',
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

const auditPublic = async (
  context: PublicAnalyticsServiceContext,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: 'system',
    action: ANALYTICS_ACTIONS.publicLocalIntelligence,
    resourceType: 'system',
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

export const getAnalyticsOverview = async (
  context: AnalyticsServiceContext,
  query: AnalyticsQueryInput
): Promise<Record<string, unknown>> => {
  const match = baseMatch(query);
  const [totalReports, byStatus, bySeverity] = await Promise.all([
    ReportModel.countDocuments(match),
    ReportModel.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ReportModel.aggregate([{ $match: match }, { $group: { _id: '$severity', count: { $sum: 1 } } }])
  ]);

  await audit(context, ANALYTICS_ACTIONS.overview, { totalReports });

  return {
    totalReports,
    byStatus,
    bySeverity,
    privacy: {
      anonymisedOnly: true,
      minimumCellSuppression: 5
    }
  };
};

export const getAnalyticsHeatmap = async (
  context: AnalyticsServiceContext,
  query: AnalyticsQueryInput
): Promise<unknown[]> => {
  const rows = await ReportModel.aggregate<unknown>([
    { $match: baseMatch(query) },
    { $group: { _id: { jurisdiction: '$jurisdiction', lga: '$lga' }, count: { $sum: 1 } } },
    { $match: { count: { $gte: 5 } } },
    { $sort: { count: -1 } }
  ]);

  await audit(context, ANALYTICS_ACTIONS.heatmap, { count: rows.length });

  return rows;
};

export const getAnalyticsTrends = async (
  context: AnalyticsServiceContext,
  query: AnalyticsQueryInput
): Promise<unknown[]> => {
  const rows = await ReportModel.aggregate<unknown>([
    { $match: baseMatch(query) },
    {
      $group: {
        _id: {
          day: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.day': 1 } }
  ]);

  await audit(context, ANALYTICS_ACTIONS.trends, { count: rows.length });

  return rows;
};

export const getAnalyticsCategories = async (
  context: AnalyticsServiceContext,
  query: AnalyticsQueryInput
): Promise<unknown[]> => {
  const rows = await ReportModel.aggregate<unknown>([
    { $match: baseMatch(query) },
    { $group: { _id: '$incidentType', count: { $sum: 1 } } },
    { $match: { count: { $gte: 5 } } },
    { $sort: { count: -1 } }
  ]);

  await audit(context, ANALYTICS_ACTIONS.categories, { count: rows.length });

  return rows;
};

export const getAnalyticsLanguages = async (
  context: AnalyticsServiceContext,
  query: AnalyticsQueryInput
): Promise<unknown[]> => {
  const rows = await ReportModel.aggregate<unknown>([
    { $match: baseMatch(query) },
    { $group: { _id: '$language', count: { $sum: 1 } } },
    { $match: { count: { $gte: 5 } } },
    { $sort: { count: -1 } }
  ]);

  await audit(context, ANALYTICS_ACTIONS.languages, { count: rows.length });

  return rows;
};

export const getPublicLocalIntelligence = async (
  context: PublicAnalyticsServiceContext,
  query: LocalIntelligenceQueryInput
): Promise<Record<string, unknown>> => {
  const match = publicLocalIntelligenceMatch(query);

  const [
    totalReports,
    areaRows,
    categoryRows,
    trendRows,
    jurisdictionOptionRows,
    regionOptionRows,
    categoryOptionRows
  ] = await Promise.all([
    ReportModel.countDocuments(match),
    ReportModel.aggregate<LocalIntelligenceAreaRow>([
      { $match: match },
      {
        $group: {
          _id: {
            jurisdiction: { $ifNull: ['$jurisdiction', 'Unspecified'] },
            region: { $ifNull: ['$lga', 'Unspecified'] }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1, '_id.jurisdiction': 1, '_id.region': 1 } }
    ]),
    ReportModel.aggregate<LocalIntelligenceNamedRow>([
      { $match: match },
      { $group: { _id: { $ifNull: ['$incidentType', 'Unspecified'] }, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } }
    ]),
    ReportModel.aggregate<LocalIntelligenceNamedRow>([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: '$createdAt'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    ReportModel.aggregate<LocalIntelligenceNamedRow>([
      { $match: publicFilterOptionMatch(query, ['jurisdiction', 'region']) },
      { $group: { _id: { $ifNull: ['$jurisdiction', 'Unspecified'] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    ReportModel.aggregate<LocalIntelligenceNamedRow>([
      { $match: publicFilterOptionMatch(query, ['region']) },
      { $group: { _id: { $ifNull: ['$lga', 'Unspecified'] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    ReportModel.aggregate<LocalIntelligenceNamedRow>([
      { $match: publicFilterOptionMatch(query, ['category']) },
      { $group: { _id: { $ifNull: ['$incidentType', 'Unspecified'] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])
  ]);

  const areas = areaRows.map((row) => ({
    jurisdiction: normalizeDimension(row._id.jurisdiction, 'Unspecified'),
    region: normalizeDimension(row._id.region, 'Unspecified'),
    ...publicCell(row.count)
  }));
  const categories = categoryRows.map((row) => ({
    category: normalizeDimension(row._id, 'Unspecified'),
    ...publicCell(row.count)
  }));
  const trends = trendRows.map((row) => ({
    period: normalizeDimension(row._id, 'Unspecified'),
    ...publicCell(row.count)
  }));
  const visibleAreas = areas.filter((area) => !area.suppressed);
  const visibleCategories = categories.filter((category) => !category.suppressed);
  const visibleTrends = trends.filter((trend) => !trend.suppressed);
  const insufficientData =
    totalReports < MINIMUM_PUBLIC_CELL_SIZE ||
    (visibleAreas.length === 0 && visibleCategories.length === 0 && visibleTrends.length === 0);

  await auditPublic(context, {
    timeframe: query.timeframe,
    jurisdiction: query.jurisdiction,
    region: query.region,
    category: query.category,
    visibleAreas: visibleAreas.length,
    visibleCategories: visibleCategories.length,
    visibleTrends: visibleTrends.length,
    insufficientData
  });

  return {
    generatedAt: new Date().toISOString(),
    timeframe: query.timeframe,
    filters: {
      jurisdiction: query.jurisdiction,
      region: query.region,
      category: query.category
    },
    summary: {
      reports: suppressCount(totalReports),
      visibleAreaCount: visibleAreas.length,
      visibleCategoryCount: visibleCategories.length,
      visibleTrendCount: visibleTrends.length,
      status: insufficientData ? 'insufficient_data' : 'available'
    },
    areas,
    categories,
    trends,
    availableFilters: {
      jurisdictions: toThresholdedOptions(jurisdictionOptionRows),
      regions: toThresholdedOptions(regionOptionRows),
      categories: toThresholdedOptions(categoryOptionRows)
    },
    privacy: {
      anonymisedOnly: true,
      consentedReportsOnly: true,
      excludesDeletedWithdrawnAndDraftReports: true,
      minimumCellSize: MINIMUM_PUBLIC_CELL_SIZE,
      lowCountLabel: `Privacy protected: fewer than ${MINIMUM_PUBLIC_CELL_SIZE}`,
      rawReportsExposed: false,
      piiExposed: false
    }
  };
};

const protectAnalyticsBucketRows = (
  rows: AnalyticsBucketRow[],
  counters: AnalyticsExportPrivacyCounters
): ProtectedAnalyticsBucket[] =>
  rows.map((row) => {
    const protectedCount = protectAnalyticsExportCount(row.count);

    if (protectedCount.suppressed) {
      counters.suppressedCells += 1;
    } else if (protectedCount.noiseApplied) {
      counters.noisyCounts += 1;
    }

    return {
      _id: row._id,
      ...protectedCount
    };
  });

const createAnalyticsExportPrivacyPolicy = () => ({
  anonymisedOnly: true,
  consentedReportsOnly: true,
  rawReportsExposed: false,
  piiExposed: false,
  minimumCellSuppression: MINIMUM_PUBLIC_CELL_SIZE,
  differentialPrivacy: {
    enabled: true,
    mechanism: 'laplace',
    epsilon: ANALYTICS_EXPORT_EPSILON,
    sensitivity: ANALYTICS_EXPORT_SENSITIVITY,
    maxAbsoluteNoise: ANALYTICS_EXPORT_MAX_ABSOLUTE_NOISE,
    appliedTo: ['summary.reports', 'dimensions.*.count'],
    lowCountCellsSuppressedBeforeNoise: true,
    negativeCountsClampedToZero: true
  }
});

const formatExportBucket = (
  bucket: ProtectedAnalyticsBucket['_id']
): string | Record<string, string | null> => {
  if (bucket === undefined || bucket === null) {
    return 'Unspecified';
  }

  return bucket;
};

const flattenProtectedExportRows = (
  dimensions: Record<string, ProtectedAnalyticsBucket[]>
): Array<Record<string, unknown>> =>
  Object.entries(dimensions).flatMap(([dimension, rows]) =>
    rows.map((row) => ({
      dimension,
      bucket:
        typeof row._id === 'object' && row._id !== null
          ? JSON.stringify(row._id)
          : formatExportBucket(row._id),
      count: row.count,
      suppressed: row.suppressed,
      label: row.label,
      noiseApplied: row.noiseApplied
    }))
  );

const csvEscape = (value: unknown): string => {
  const normalized =
    value === undefined || value === null
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);

  return `"${normalized.replace(/"/g, '""')}"`;
};

const createAnalyticsExportCsv = (rows: Array<Record<string, unknown>>): string => {
  const headers = ['dimension', 'bucket', 'count', 'suppressed', 'label', 'noiseApplied'];
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ];

  return lines.join('\n');
};

export const exportAnalytics = async (
  context: AnalyticsServiceContext,
  query: AnalyticsExportQueryInput
): Promise<Record<string, unknown>> => {
  const exportId = randomUUID();
  const match = baseMatch(query);
  const privacyCounters: AnalyticsExportPrivacyCounters = {
    noisyCounts: 0,
    suppressedCells: 0
  };
  const [totalReports, byStatus, bySeverity, byIncidentType, byJurisdiction, byLanguage] =
    await Promise.all([
      ReportModel.countDocuments(match),
      ReportModel.aggregate<AnalyticsBucketRow>([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } }
      ]),
      ReportModel.aggregate<AnalyticsBucketRow>([
        { $match: match },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } }
      ]),
      ReportModel.aggregate<AnalyticsBucketRow>([
        { $match: match },
        { $group: { _id: '$incidentType', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } }
      ]),
      ReportModel.aggregate<AnalyticsBucketRow>([
        { $match: match },
        { $group: { _id: '$jurisdiction', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } }
      ]),
      ReportModel.aggregate<AnalyticsBucketRow>([
        { $match: match },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } }
      ])
    ]);
  const protectedSummary = protectAnalyticsExportCount(totalReports);

  if (protectedSummary.suppressed) {
    privacyCounters.suppressedCells += 1;
  } else if (protectedSummary.noiseApplied) {
    privacyCounters.noisyCounts += 1;
  }

  const dimensions = {
    byStatus: protectAnalyticsBucketRows(byStatus, privacyCounters),
    bySeverity: protectAnalyticsBucketRows(bySeverity, privacyCounters),
    byIncidentType: protectAnalyticsBucketRows(byIncidentType, privacyCounters),
    byJurisdiction: protectAnalyticsBucketRows(byJurisdiction, privacyCounters),
    byLanguage: protectAnalyticsBucketRows(byLanguage, privacyCounters)
  };
  const rows = flattenProtectedExportRows(dimensions);
  const privacy = createAnalyticsExportPrivacyPolicy();

  await audit(context, ANALYTICS_ACTIONS.export, {
    exportId,
    format: query.format,
    noisyCounts: privacyCounters.noisyCounts,
    suppressedCells: privacyCounters.suppressedCells,
    dimensions: Object.keys(dimensions),
    differentialPrivacy: privacy.differentialPrivacy
  });

  return {
    exportId,
    format: query.format,
    generatedAt: new Date().toISOString(),
    filters: {
      from: query.from,
      to: query.to,
      jurisdiction: query.jurisdiction,
      language: query.language
    },
    privacy,
    summary: {
      reports: protectedSummary
    },
    dimensions,
    rows,
    ...(query.format === 'csv'
      ? {
          contentType: 'text/csv',
          content: createAnalyticsExportCsv(rows)
        }
      : {})
  };
};
