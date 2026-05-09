import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  AnalyzeEmailInput,
  AnalyzeScreenshotInput,
  AnalyzeTextInput,
  CheckUrlInput,
  GenerateReportDraftInput,
  RedactScamContentInput,
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
  const analysis = await analyzeScreenshot(getContext(req), req.body as AnalyzeScreenshotInput);

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

export const submitController = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await submitScamReport(getContext(req), req.body as SubmitScamReportInput);

  res.status(StatusCodes.OK).json(successResponse('ScamShield report submitted', { analysis }));
});
