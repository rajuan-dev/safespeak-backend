import { createAuditLog } from '@modules/audit/audit.service';
import { ReportModel } from '@modules/reports/reports.model';

import { ANALYTICS_ACTIONS } from './analytics.constants';
import type { AnalyticsExportQueryInput, AnalyticsQueryInput } from './analytics.schema';
import type { AnalyticsServiceContext } from './analytics.types';

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
