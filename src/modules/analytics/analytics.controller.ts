import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type { AnalyticsExportQueryInput, LocalIntelligenceQueryInput } from './analytics.schema';
import {
  exportAnalytics,
  getAnalyticsCategories,
  getAnalyticsHeatmap,
  getAnalyticsLanguages,
  getAnalyticsOverview,
  getAnalyticsTrends,
  getPublicLocalIntelligence
} from './analytics.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id ?? ''
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

const getPublicContext = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicLocalIntelligenceController = asyncHandler(
  async (req: Request, res: Response) => {
    const localIntelligence = await getPublicLocalIntelligence(
      getPublicContext(req),
      req.query as LocalIntelligenceQueryInput
    );

    res
      .status(StatusCodes.OK)
      .json(
        successResponse('Public local intelligence retrieved', {
          localIntelligence
        })
      );
  }
);

export const analyticsOverviewController = asyncHandler(async (req: Request, res: Response) => {
  const overview = await getAnalyticsOverview(getContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Analytics overview retrieved', { overview }));
});

export const analyticsHeatmapController = asyncHandler(async (req: Request, res: Response) => {
  const heatmap = await getAnalyticsHeatmap(getContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Analytics heatmap retrieved', { heatmap }));
});

export const analyticsTrendsController = asyncHandler(async (req: Request, res: Response) => {
  const trends = await getAnalyticsTrends(getContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Analytics trends retrieved', { trends }));
});

export const analyticsCategoriesController = asyncHandler(async (req: Request, res: Response) => {
  const categories = await getAnalyticsCategories(getContext(req), req.query);

  res
    .status(StatusCodes.OK)
    .json(successResponse('Analytics categories retrieved', { categories }));
});

export const analyticsLanguagesController = asyncHandler(async (req: Request, res: Response) => {
  const languages = await getAnalyticsLanguages(getContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Analytics languages retrieved', { languages }));
});

export const analyticsExportController = asyncHandler(async (req: Request, res: Response) => {
  const exportPayload = await exportAnalytics(
    getContext(req),
    req.query as AnalyticsExportQueryInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Analytics export generated', { export: exportPayload }));
});
