import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  CreateMicroEducationInput,
  UpdateMicroEducationInput
} from './microeducation.schema';
import {
  createMicroEducation,
  deleteMicroEducation,
  getMicroEducationImage,
  listAdminMicroEducation,
  listPublicMicroEducation,
  updateMicroEducation
} from './microeducation.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicMicroEducationController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await listPublicMicroEducation(getContext(req));

    res.status(StatusCodes.OK).json(successResponse('Micro-education items retrieved', { items }));
  }
);

export const publicMicroEducationImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const image = await getMicroEducationImage(getContext(req), req.params.id);

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

export const adminMicroEducationListController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await listAdminMicroEducation(
      getContext(req),
      req.query
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin micro-education items retrieved', { items }));
  }
);

export const adminMicroEducationCreateController = asyncHandler(
  async (req: Request, res: Response) => {
    const item = await createMicroEducation(
      getContext(req),
      req.body as CreateMicroEducationInput,
      req.file
    );

    res.status(StatusCodes.CREATED).json(successResponse('Micro-education item created', { item }));
  }
);

export const adminMicroEducationUpdateController = asyncHandler(
  async (req: Request, res: Response) => {
    const item = await updateMicroEducation(
      getContext(req),
      req.params.id,
      req.body as UpdateMicroEducationInput,
      req.file
    );

    res.status(StatusCodes.OK).json(successResponse('Micro-education item updated', { item }));
  }
);

export const adminMicroEducationDeleteController = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteMicroEducation(getContext(req), req.params.id);

    res.status(StatusCodes.OK).json(successResponse('Micro-education item deleted', null));
  }
);
