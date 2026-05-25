import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import {
  acknowledgeReportSubmission,
  createReport,
  getReportById,
  getReportDestinationPreviews,
  getReportSubmissionPayloadPreviews,
  getReportStatus,
  getReportTimeline,
  listReportSubmissions,
  listReports,
  markReportInfoOnly,
  requestReportDelete,
  softDeleteReport,
  submitReportToDestination,
  updateReport,
  withdrawReport
} from './reports.service';
import type {
  AcknowledgeSubmissionInput,
  CreateReportInput,
  ReportDestinationPreviewQueryInput,
  SubmissionPreviewInput,
  SubmitReportInput,
  UpdateReportInput
} from './reports.schema';

const getOwner = (req: Request) => ({
  userId: req.user?.id,
  sessionId: req.session?.id
});

export const createReportController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as CreateReportInput;
  const report = await createReport(getOwner(req), input, req.ip, req.get('user-agent'));

  ApiResponse.created(res, 'Report created', { report });
});

export const listReportsController = asyncHandler(async (req: Request, res: Response) => {
  const reports = await listReports(getOwner(req));

  ApiResponse.success(res, 'Reports retrieved', { reports });
});

export const getReportController = asyncHandler(async (req: Request, res: Response) => {
  const report = await getReportById(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Report retrieved', { report });
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

  ApiResponse.success(res, 'Report updated', { report });
});

export const deleteReportController = asyncHandler(async (req: Request, res: Response) => {
  await softDeleteReport(getOwner(req), req.params.id, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Report deleted', null);
});

export const markInfoOnlyController = asyncHandler(async (req: Request, res: Response) => {
  const report = await markReportInfoOnly(
    getOwner(req),
    req.params.id,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Report marked information-only', { report });
});

export const withdrawReportController = asyncHandler(async (req: Request, res: Response) => {
  const report = await withdrawReport(getOwner(req), req.params.id, req.ip, req.get('user-agent'));

  ApiResponse.success(res, 'Report withdrawn', { report });
});

export const requestDeleteController = asyncHandler(async (req: Request, res: Response) => {
  const report = await requestReportDelete(
    getOwner(req),
    req.params.id,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.success(res, 'Report deletion requested', { report });
});

export const getReportStatusController = asyncHandler(async (req: Request, res: Response) => {
  const status = await getReportStatus(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Report status retrieved', { status });
});

export const getReportTimelineController = asyncHandler(async (req: Request, res: Response) => {
  const timeline = await getReportTimeline(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Report timeline retrieved', { timeline });
});

export const getReportDestinationPreviewsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as ReportDestinationPreviewQueryInput;
    const destinations = await getReportDestinationPreviews(getOwner(req), req.params.id, query);

    ApiResponse.success(res, 'Report destination previews retrieved', { destinations });
  }
);

export const listReportSubmissionsController = asyncHandler(async (req: Request, res: Response) => {
  const submissions = await listReportSubmissions(getOwner(req), req.params.id);

  ApiResponse.success(res, 'Report submissions retrieved', { submissions });
});

export const previewReportSubmissionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = req.body as unknown as SubmissionPreviewInput;
    const previews = await getReportSubmissionPayloadPreviews(getOwner(req), req.params.id, input);

    ApiResponse.success(res, 'Report submission payload previews generated', { previews });
  }
);

export const submitReportController = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as unknown as SubmitReportInput;
  const submission = await submitReportToDestination(
    getOwner(req),
    req.params.id,
    input,
    req.ip,
    req.get('user-agent')
  );

  ApiResponse.created(res, 'Report delivery attempt recorded', { submission });
});

export const acknowledgeReportSubmissionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = req.body as unknown as AcknowledgeSubmissionInput;
    const submission = await acknowledgeReportSubmission(
      getOwner(req),
      req.params.id,
      req.params.submissionId,
      input,
      req.ip,
      req.get('user-agent')
    );

    ApiResponse.success(res, 'Report submission acknowledgement recorded', { submission });
  }
);
