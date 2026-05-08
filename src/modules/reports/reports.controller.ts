import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import {
  createReport,
  getReportById,
  getReportStatus,
  getReportTimeline,
  listReports,
  markReportInfoOnly,
  requestReportDelete,
  softDeleteReport,
  updateReport,
  withdrawReport
} from './reports.service';
import type { CreateReportInput, UpdateReportInput } from './reports.schema';

const getOwner = (req: Request) => ({
  userId: req.user?.id,
  sessionId: req.session?.id
});

export const createReportController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as CreateReportInput;
  const report = await createReport(getOwner(req), input, req.ip, req.get('user-agent'));

  res.status(StatusCodes.CREATED).json(successResponse('Report created', { report }));
});

export const listReportsController = asyncHandler(async (req: Request, res: Response) => {
  const reports = await listReports(getOwner(req));

  res.status(StatusCodes.OK).json(successResponse('Reports retrieved', { reports }));
});

export const getReportController = asyncHandler(async (req: Request, res: Response) => {
  const report = await getReportById(getOwner(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Report retrieved', { report }));
});

export const updateReportController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as UpdateReportInput;
  const report = await updateReport(
    getOwner(req),
    req.params.id,
    input,
    req.ip,
    req.get('user-agent')
  );

  res.status(StatusCodes.OK).json(successResponse('Report updated', { report }));
});

export const deleteReportController = asyncHandler(async (req: Request, res: Response) => {
  await softDeleteReport(getOwner(req), req.params.id, req.ip, req.get('user-agent'));

  res.status(StatusCodes.OK).json(successResponse('Report deleted', {}));
});

export const markInfoOnlyController = asyncHandler(async (req: Request, res: Response) => {
  const report = await markReportInfoOnly(
    getOwner(req),
    req.params.id,
    req.ip,
    req.get('user-agent')
  );

  res.status(StatusCodes.OK).json(successResponse('Report marked information-only', { report }));
});

export const withdrawReportController = asyncHandler(async (req: Request, res: Response) => {
  const report = await withdrawReport(getOwner(req), req.params.id, req.ip, req.get('user-agent'));

  res.status(StatusCodes.OK).json(successResponse('Report withdrawn', { report }));
});

export const requestDeleteController = asyncHandler(async (req: Request, res: Response) => {
  const report = await requestReportDelete(
    getOwner(req),
    req.params.id,
    req.ip,
    req.get('user-agent')
  );

  res.status(StatusCodes.OK).json(successResponse('Report deletion requested', { report }));
});

export const getReportStatusController = asyncHandler(async (req: Request, res: Response) => {
  const status = await getReportStatus(getOwner(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Report status retrieved', { status }));
});

export const getReportTimelineController = asyncHandler(async (req: Request, res: Response) => {
  const timeline = await getReportTimeline(getOwner(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Report timeline retrieved', { timeline }));
});
