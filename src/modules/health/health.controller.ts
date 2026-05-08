import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { successResponse } from '@common/responses/api-response';

import { getHealthStatus } from './health.service';

export const healthController = (_req: Request, res: Response): void => {
  res.status(StatusCodes.OK).json(successResponse('Service is healthy', getHealthStatus()));
};
