import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';

import { MICRO_EDUCATION_ACTIONS } from './microeducation.constants';
import {
  MicroEducationCategoryModel,
  type MicroEducationCategoryDocument
} from './microeducation-category.model';
import type {
  CreateMicroEducationCategoryInput,
  MicroEducationCategoryQueryInput,
  UpdateMicroEducationCategoryInput
} from './microeducation-category.schema';
import { MicroEducationModel } from './microeducation.model';
import type { MicroEducationServiceContext } from './microeducation.types';

const DEFAULT_CATEGORY_NAME = 'General Safety';

const serializeMicroEducationCategory = (
  category: MicroEducationCategoryDocument | Record<string, unknown>,
  cardCount?: number
) => {
  const raw = category as MicroEducationCategoryDocument & { _id: { toString: () => string } };

  return {
    id: raw._id.toString(),
    name: raw.name,
    description: raw.description,
    backgroundColor: raw.backgroundColor,
    textColor: raw.textColor,
    iconName: raw.iconName,
    imageUrl: raw.imageUrl,
    status: raw.status,
    sortOrder: raw.sortOrder,
    cardCount,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const auditMicroEducationCategoryAction = async (
  context: MicroEducationServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.actor?.userId ? 'admin' : 'system',
    actorId: context.actor?.userId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

export const ensureDefaultMicroEducationCategory = async (
  context?: MicroEducationServiceContext
): Promise<MicroEducationCategoryDocument> => {
  const existingCategory = await MicroEducationCategoryModel.findOne({
    name: DEFAULT_CATEGORY_NAME,
    deletedAt: { $exists: false }
  });

  const category =
    existingCategory ??
    (await MicroEducationCategoryModel.create({
      name: DEFAULT_CATEGORY_NAME,
      description: 'Default category for existing micro-education cards.',
      backgroundColor: '#01579B',
      textColor: '#FFFFFF',
      iconName: 'shield',
      status: 'published',
      sortOrder: 0,
      createdBy: context?.actor?.userId,
      updatedBy: context?.actor?.userId
    }));

  await MicroEducationModel.updateMany(
    {
      deletedAt: { $exists: false },
      $or: [{ categoryId: { $exists: false } }, { categoryId: null }]
    },
    {
      $set: {
        categoryId: category._id,
        updatedBy: context?.actor?.userId
      }
    }
  );

  return category;
};

const buildCategoryQuery = (query: MicroEducationCategoryQueryInput, publicOnly: boolean) => {
  const normalizedSearch = query.search?.trim();

  return {
    deletedAt: { $exists: false },
    ...(publicOnly ? { status: 'published' } : query.status ? { status: query.status } : {}),
    ...(normalizedSearch
      ? {
          $or: [
            { name: { $regex: normalizedSearch, $options: 'i' } },
            { description: { $regex: normalizedSearch, $options: 'i' } },
            { iconName: { $regex: normalizedSearch, $options: 'i' } }
          ]
        }
      : {})
  };
};

const getCardCountsByCategory = async (categoryIds: string[], publicOnly: boolean) => {
  const counts = await MicroEducationModel.aggregate<{
    _id: string;
    count: number;
  }>([
    {
      $match: {
        deletedAt: { $exists: false },
        ...(publicOnly ? { status: 'published' } : {}),
        categoryId: { $in: categoryIds.map((id) => new Types.ObjectId(id)) }
      }
    },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } }
  ]);

  return new Map(counts.map((item) => [String(item._id), item.count]));
};

export const listPublicMicroEducationCategories = async (
  context: MicroEducationServiceContext
): Promise<unknown[]> => {
  await ensureDefaultMicroEducationCategory(context);

  const categories = await MicroEducationCategoryModel.find(buildCategoryQuery({}, true))
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const cardCounts = await getCardCountsByCategory(
    categories.map((category) => category._id.toString()),
    true
  );
  const visibleCategories = categories.filter(
    (category) => (cardCounts.get(category._id.toString()) ?? 0) > 0
  );

  await auditMicroEducationCategoryAction(
    context,
    MICRO_EDUCATION_ACTIONS.categoryListPublic,
    undefined,
    { count: visibleCategories.length }
  );

  return visibleCategories.map((category) =>
    serializeMicroEducationCategory(category, cardCounts.get(category._id.toString()) ?? 0)
  );
};

export const listAdminMicroEducationCategories = async (
  context: MicroEducationServiceContext,
  query: MicroEducationCategoryQueryInput
): Promise<unknown[]> => {
  await ensureDefaultMicroEducationCategory(context);

  const categories = await MicroEducationCategoryModel.find(buildCategoryQuery(query, false))
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const cardCounts = await getCardCountsByCategory(
    categories.map((category) => category._id.toString()),
    false
  );

  await auditMicroEducationCategoryAction(
    context,
    MICRO_EDUCATION_ACTIONS.categoryListAdmin,
    undefined,
    { count: categories.length }
  );

  return categories.map((category) =>
    serializeMicroEducationCategory(category, cardCounts.get(category._id.toString()) ?? 0)
  );
};

export const createMicroEducationCategory = async (
  context: MicroEducationServiceContext,
  input: CreateMicroEducationCategoryInput
): Promise<unknown> => {
  const category = await MicroEducationCategoryModel.create({
    ...input,
    createdBy: context.actor?.userId,
    updatedBy: context.actor?.userId
  });

  await auditMicroEducationCategoryAction(
    context,
    MICRO_EDUCATION_ACTIONS.categoryCreate,
    category._id.toString(),
    { status: category.status }
  );

  return serializeMicroEducationCategory(category, 0);
};

export const updateMicroEducationCategory = async (
  context: MicroEducationServiceContext,
  id: string,
  input: UpdateMicroEducationCategoryInput
): Promise<unknown> => {
  const category = await MicroEducationCategoryModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!category) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education category not found');
  }

  category.set({
    ...input,
    updatedBy: context.actor?.userId
  });
  await category.save();

  const cardCount = await MicroEducationModel.countDocuments({
    categoryId: category._id,
    deletedAt: { $exists: false }
  });

  await auditMicroEducationCategoryAction(
    context,
    MICRO_EDUCATION_ACTIONS.categoryUpdate,
    category._id.toString(),
    { changedFields: Object.keys(input) }
  );

  return serializeMicroEducationCategory(category, cardCount);
};

export const deleteMicroEducationCategory = async (
  context: MicroEducationServiceContext,
  id: string
): Promise<void> => {
  const category = await MicroEducationCategoryModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!category) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education category not found');
  }

  const assignedCardCount = await MicroEducationModel.countDocuments({
    categoryId: category._id,
    deletedAt: { $exists: false }
  });

  if (assignedCardCount > 0) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Move or delete the assigned micro-education cards before deleting this category.'
    );
  }

  category.deletedAt = new Date();
  category.updatedBy = context.actor?.userId as never;
  await category.save();

  await auditMicroEducationCategoryAction(
    context,
    MICRO_EDUCATION_ACTIONS.categoryDelete,
    category._id.toString()
  );
};
