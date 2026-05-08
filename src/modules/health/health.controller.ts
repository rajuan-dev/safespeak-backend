import type { Request, Response } from 'express';

import { ApiResponse } from '@common/responses/api-response';

import { getHealthStatus } from './health.service';

export const healthController = (_req: Request, res: Response): void => {
  ApiResponse.success(res, 'Service is healthy', getHealthStatus());
};
