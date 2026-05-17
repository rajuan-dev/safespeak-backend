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

export const exportAnalytics = async (
  context: AnalyticsServiceContext,
  query: AnalyticsExportQueryInput
): Promise<Record<string, unknown>> => {
  const overview = await getAnalyticsOverview(context, query);

  await audit(context, ANALYTICS_ACTIONS.export, { format: query.format });

  return {
    format: query.format,
    generatedAt: new Date().toISOString(),
    overview
  };
};
