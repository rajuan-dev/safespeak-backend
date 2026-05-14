import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  CreateContentResourceInput,
  UpdateContentResourceInput
} from './content-resources.schema';
import {
  createContentResource,
  deleteContentResource,
  getAdminContentResource,
  getContentResourceDownload,
  getContentResourceImage,
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

const getMultipartFile = (req: Request, fieldName: 'file' | 'image'): Express.Multer.File | undefined => {
  if (!req.files || Array.isArray(req.files)) {
    return undefined;
  }

  return req.files[fieldName]?.[0];
};

export const publicContentResourcesListController = asyncHandler(
  async (req: Request, res: Response) => {
    const resources = await listPublicContentResources(
      getContext(req),
      req.query
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

export const publicContentResourceImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const image = await getContentResourceImage(getContext(req), req.params.id);

    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(image.fileSizeBytes));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(image.originalFileName)}"`
    );

    image.stream.pipe(res);
  }
);

export const adminContentResourcesListController = asyncHandler(
  async (req: Request, res: Response) => {
    const resources = await listAdminContentResources(
      getContext(req),
      req.query
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
      getMultipartFile(req, 'file'),
      getMultipartFile(req, 'image')
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
      getMultipartFile(req, 'file'),
      getMultipartFile(req, 'image')
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
