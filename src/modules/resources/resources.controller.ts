import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  CreateResourceInput,
  ResourceAdminQueryInput,
  UpdateResourceInput
} from './resources.schema';
import {
  createResource,
  deleteResource,
  listAdminResources,
  listPublicResources,
  updateResource
} from './resources.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicResourcesController = asyncHandler(async (req: Request, res: Response) => {
  const resources = await listPublicResources(getContext(req));

  res.status(StatusCodes.OK).json(successResponse('Resources retrieved', { resources }));
});

export const adminResourcesListController = asyncHandler(async (req: Request, res: Response) => {
  const resources = await listAdminResources(
    getContext(req),
    req.query as unknown as ResourceAdminQueryInput
  );

  res.status(StatusCodes.OK).json(successResponse('Admin resources retrieved', { resources }));
});

export const adminResourcesCreateController = asyncHandler(async (req: Request, res: Response) => {
  const resource = await createResource(getContext(req), req.body as CreateResourceInput);

  res.status(StatusCodes.CREATED).json(successResponse('Resource created', { resource }));
});

export const adminResourcesUpdateController = asyncHandler(async (req: Request, res: Response) => {
  const resource = await updateResource(
    getContext(req),
    req.params.id,
    req.body as UpdateResourceInput
  );

  res.status(StatusCodes.OK).json(successResponse('Resource updated', { resource }));
});

export const adminResourcesDeleteController = asyncHandler(async (req: Request, res: Response) => {
  await deleteResource(getContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Resource deleted', null));
});
