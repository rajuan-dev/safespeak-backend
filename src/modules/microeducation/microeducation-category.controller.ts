import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  CreateMicroEducationCategoryInput,
  UpdateMicroEducationCategoryInput
} from './microeducation-category.schema';
import {
  createMicroEducationCategory,
  deleteMicroEducationCategory,
  listAdminMicroEducationCategories,
  listPublicMicroEducationCategories,
  updateMicroEducationCategory
} from './microeducation-category.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const publicMicroEducationCategoryListController = asyncHandler(
  async (req: Request, res: Response) => {
    const categories = await listPublicMicroEducationCategories(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Micro-education categories retrieved', { categories }));
  }
);

export const adminMicroEducationCategoryListController = asyncHandler(
  async (req: Request, res: Response) => {
    const categories = await listAdminMicroEducationCategories(getContext(req), req.query);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin micro-education categories retrieved', { categories }));
  }
);

export const adminMicroEducationCategoryCreateController = asyncHandler(
  async (req: Request, res: Response) => {
    const category = await createMicroEducationCategory(
      getContext(req),
      req.body as CreateMicroEducationCategoryInput
    );

    res
      .status(StatusCodes.CREATED)
      .json(successResponse('Micro-education category created', { category }));
  }
);

export const adminMicroEducationCategoryUpdateController = asyncHandler(
  async (req: Request, res: Response) => {
    const category = await updateMicroEducationCategory(
      getContext(req),
      req.params.id,
      req.body as UpdateMicroEducationCategoryInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Micro-education category updated', { category }));
  }
);

export const adminMicroEducationCategoryDeleteController = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteMicroEducationCategory(getContext(req), req.params.id);

    res.status(StatusCodes.OK).json(successResponse('Micro-education category deleted', null));
  }
);
