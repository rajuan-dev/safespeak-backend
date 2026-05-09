import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import {
  extractIncidentFields,
  generateClarifyingQuestions,
  generateSummary,
  redactPii,
  translateText,
  triageReport
} from './ai.service';
import type {
  ClarifyingQuestionsInput,
  ExtractIncidentFieldsInput,
  GenerateSummaryInput,
  RedactPiiInput,
  TranslateInput,
  TriageReportInput
} from './ai.schema';

const getContext = (req: Request) => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const extractIncidentFieldsController = asyncHandler(async (req: Request, res: Response) => {
  const result = await extractIncidentFields(
    getContext(req),
    req.body as ExtractIncidentFieldsInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Incident fields extracted', { result }, { informationOnly: true }));
});

export const triageReportController = asyncHandler(async (req: Request, res: Response) => {
  const result = await triageReport(getContext(req), req.body as TriageReportInput);

  res
    .status(StatusCodes.OK)
    .json(successResponse('Report triaged', { result }, { informationOnly: true }));
});

export const clarifyingQuestionsController = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateClarifyingQuestions(
    getContext(req),
    req.body as ClarifyingQuestionsInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Clarifying questions generated', { result }, { informationOnly: true }));
});

export const generateSummaryController = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateSummary(getContext(req), req.body as GenerateSummaryInput);

  res
    .status(StatusCodes.OK)
    .json(successResponse('Summary generated', { result }, { informationOnly: true }));
});

export const translateController = asyncHandler(async (req: Request, res: Response) => {
  const result = await translateText(getContext(req), req.body as TranslateInput);

  res
    .status(StatusCodes.OK)
    .json(successResponse('Text translated', { result }, { informationOnly: true }));
});

export const redactPiiController = asyncHandler(async (req: Request, res: Response) => {
  const result = await redactPii(getContext(req), req.body as RedactPiiInput);

  res
    .status(StatusCodes.OK)
    .json(successResponse('PII redacted', { result }, { informationOnly: true }));
});
