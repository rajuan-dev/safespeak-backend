import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  AnalyzeEmailInput,
  AnalyzeTextInput,
  CheckUrlInput,
  GenerateReportDraftByIdInput,
  GenerateReportDraftInput,
  RedactScamContentInput,
  SubmitScamReportByIdInput,
  SubmitScamReportInput
} from './scamshield.schema';
import {
  analyzeEmail,
  analyzeScreenshot,
  analyzeText,
  checkUrl,
  generateReportDraft,
  getAnalysisById,
  redactScamContent,
  submitScamReport
} from './scamshield.service';

const getContext = (req: Request) => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

type ScreenshotRequestBody = Partial<{
  imageText: string;
  imageBase64: string;
  mimeType: string;
  evidenceId: string;
  reportId: string;
  metadata: string | Record<string, unknown>;
}>;

const parseScreenshotMetadata = (
  metadata: ScreenshotRequestBody['metadata']
): Record<string, unknown> => {
  if (typeof metadata === 'string') {
    return JSON.parse(metadata) as Record<string, unknown>;
  }

  return metadata ?? {};
};

export const analyzeTextController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await analyzeText(getContext(req), req.body as AnalyzeTextInput);

  res
    .status(StatusCodes.CREATED)
    .json(successResponse('ScamShield text analysis completed', { analysis }));
});

export const analyzeEmailController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await analyzeEmail(getContext(req), req.body as AnalyzeEmailInput);

  res
    .status(StatusCodes.CREATED)
    .json(successResponse('ScamShield email analysis completed', { analysis }));
});

export const analyzeScreenshotController = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const files = Array.isArray(req.files) ? req.files : file ? [file] : [];
  const body = req.body as ScreenshotRequestBody;
  const input = {
    imageText: body.imageText,
    imageBase64: files.length ? undefined : body.imageBase64,
    mimeType: files.length ? undefined : body.mimeType,
    files,
    evidenceId: body.evidenceId,
    reportId: body.reportId,
    metadata: parseScreenshotMetadata(body.metadata)
  };
  const analysis = await analyzeScreenshot(getContext(req), input);

  res
    .status(StatusCodes.CREATED)
    .json(successResponse('ScamShield screenshot analysis completed', { analysis }));
});

export const checkUrlController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await checkUrl(getContext(req), req.body as CheckUrlInput);

  res
    .status(StatusCodes.CREATED)
    .json(successResponse('ScamShield URL check completed', { analysis }));
});

export const getAnalysisController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await getAnalysisById(getContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('ScamShield analysis retrieved', { analysis }));
});

export const redactController = asyncHandler(async (req: Request, res: Response) => {
  const result = await redactScamContent(getContext(req), req.body as RedactScamContentInput);

  res.status(StatusCodes.OK).json(successResponse('ScamShield content redacted', { result }));
});

export const generateReportDraftController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await generateReportDraft(getContext(req), req.body as GenerateReportDraftInput);

  res
    .status(StatusCodes.OK)
    .json(successResponse('ScamShield report draft generated', { analysis }));
});

export const generateReportDraftByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body as GenerateReportDraftByIdInput;
    const analysis = await generateReportDraft(getContext(req), {
      analysisId: req.params.id,
      notes: body.notes
    });

    res
      .status(StatusCodes.OK)
      .json(successResponse('ScamShield report draft generated', { analysis }));
  }
);

export const submitController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await submitScamReport(getContext(req), req.body as SubmitScamReportInput);

  res.status(StatusCodes.OK).json(successResponse('ScamShield report submitted', { analysis }));
});

export const submitByIdController = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SubmitScamReportByIdInput;
  const analysis = await submitScamReport(getContext(req), {
    analysisId: req.params.id,
    destination: body.destination,
    consentToShare: body.consentToShare
  });

  res.status(StatusCodes.OK).json(successResponse('ScamShield report submitted', { analysis }));
});
