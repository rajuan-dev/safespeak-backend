import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  CreateMediaAssetInput,
  MediaAssetQueryInput,
  UpdateMediaAssetInput
} from './media-assets.schema';
import {
  createMediaAsset,
  deleteMediaAsset,
  getAdminMediaAsset,
  getMediaAssetFile,
  listAdminMediaAssets,
  listPublicMediaAssets,
  updateMediaAsset
} from './media-assets.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicMediaAssetsListController = asyncHandler(
  async (req: Request, res: Response) => {
    const assets = await listPublicMediaAssets(
      getContext(req),
      req.query as unknown as MediaAssetQueryInput
    );

    res.status(StatusCodes.OK).json(successResponse('Media assets retrieved', { assets }));
  }
);

export const publicMediaAssetFileController = asyncHandler(
  async (req: Request, res: Response) => {
    const file = await getMediaAssetFile(getContext(req), req.params.id);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.fileSizeBytes));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.originalFileName)}"`
    );

    file.stream.pipe(res);
  }
);

export const adminMediaAssetsListController = asyncHandler(
  async (req: Request, res: Response) => {
    const assets = await listAdminMediaAssets(
      getContext(req),
      req.query as unknown as MediaAssetQueryInput
    );

    res.status(StatusCodes.OK).json(successResponse('Admin media assets retrieved', { assets }));
  }
);

export const adminMediaAssetDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    const asset = await getAdminMediaAsset(getContext(req), req.params.id);

    res.status(StatusCodes.OK).json(successResponse('Admin media asset retrieved', { asset }));
  }
);

export const adminMediaAssetCreateController = asyncHandler(
  async (req: Request, res: Response) => {
    const asset = await createMediaAsset(
      getContext(req),
      req.body as CreateMediaAssetInput,
      req.file
    );

    res.status(StatusCodes.CREATED).json(successResponse('Media asset created', { asset }));
  }
);

export const adminMediaAssetUpdateController = asyncHandler(
  async (req: Request, res: Response) => {
    const asset = await updateMediaAsset(
      getContext(req),
      req.params.id,
      req.body as UpdateMediaAssetInput,
      req.file
    );

    res.status(StatusCodes.OK).json(successResponse('Media asset updated', { asset }));
  }
);

export const adminMediaAssetDeleteController = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteMediaAsset(getContext(req), req.params.id);

    res.status(StatusCodes.OK).json(successResponse('Media asset deleted', null));
  }
);
