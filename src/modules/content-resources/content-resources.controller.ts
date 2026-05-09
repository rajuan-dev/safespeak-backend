import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  ContentResourceQueryInput,
  CreateContentResourceInput,
  UpdateContentResourceInput
} from './content-resources.schema';
import {
  createContentResource,
  deleteContentResource,
  getAdminContentResource,
  getContentResourceDownload,
  listAdminContentResources,
  listPublicContentResources,
  updateContentResource
} from './content-resources.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicContentResourcesListController = asyncHandler(
  async (req: Request, res: Response) => {
    const resources = await listPublicContentResources(
      getContext(req),
      req.query as unknown as ContentResourceQueryInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Content resources retrieved', { resources }));
  }
);

export const publicContentResourceDownloadController = asyncHandler(
  async (req: Request, res: Response) => {
    const download = await getContentResourceDownload(getContext(req), req.params.id);

    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Length', String(download.fileSizeBytes));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.originalFileName)}"`
    );

    download.stream.pipe(res);
  }
);

export const adminContentResourcesListController = asyncHandler(
  async (req: Request, res: Response) => {
    const resources = await listAdminContentResources(
      getContext(req),
      req.query as unknown as ContentResourceQueryInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin content resources retrieved', { resources }));
  }
);

export const adminContentResourceDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    const resource = await getAdminContentResource(getContext(req), req.params.id);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin content resource retrieved', { resource }));
  }
);

export const adminContentResourceCreateController = asyncHandler(
  async (req: Request, res: Response) => {
    const resource = await createContentResource(
      getContext(req),
      req.body as CreateContentResourceInput,
      req.file
    );

    res.status(StatusCodes.CREATED).json(successResponse('Content resource created', { resource }));
  }
);

export const adminContentResourceUpdateController = asyncHandler(
  async (req: Request, res: Response) => {
    const resource = await updateContentResource(
      getContext(req),
      req.params.id,
      req.body as UpdateContentResourceInput,
      req.file
    );

    res.status(StatusCodes.OK).json(successResponse('Content resource updated', { resource }));
  }
);

export const adminContentResourceDeleteController = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteContentResource(getContext(req), req.params.id);

    res.status(StatusCodes.OK).json(successResponse('Content resource deleted', null));
  }
);
