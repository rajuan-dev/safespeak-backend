import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';

import { MICRO_EDUCATION_ACTIONS } from './microeducation.constants';
import { MicroEducationModel, type MicroEducationDocument } from './microeducation.model';
import type {
  CreateMicroEducationInput,
  MicroEducationAdminQueryInput,
  UpdateMicroEducationInput
} from './microeducation.schema';
import type { MicroEducationServiceContext } from './microeducation.types';

const serializeMicroEducation = (item: MicroEducationDocument | Record<string, unknown>) => {
  const raw = item as MicroEducationDocument & { _id: { toString: () => string } };

  return {
    id: raw._id.toString(),
    title: raw.title,
    summary: raw.summary,
    tag: raw.tag,
    cta: raw.cta,
    tone: raw.tone,
    chips: raw.chips,
    duration: raw.duration,
    format: raw.format,
    status: raw.status,
    sortOrder: raw.sortOrder,
    views: raw.views,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const auditMicroEducationAction = async (
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

export const listPublicMicroEducation = async (
  context: MicroEducationServiceContext
): Promise<unknown[]> => {
  const items = await MicroEducationModel.find({
    status: 'published',
    deletedAt: { $exists: false }
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.listPublic, undefined, {
    count: items.length
  });

  return items.map(serializeMicroEducation);
};

export const listAdminMicroEducation = async (
  context: MicroEducationServiceContext,
  query: MicroEducationAdminQueryInput
): Promise<unknown[]> => {
  const normalizedSearch = query.search?.trim();
  const items = await MicroEducationModel.find({
    deletedAt: { $exists: false },
    ...(query.status ? { status: query.status } : {}),
    ...(normalizedSearch
      ? {
          $or: [
            { title: { $regex: normalizedSearch, $options: 'i' } },
            { summary: { $regex: normalizedSearch, $options: 'i' } },
            { tag: { $regex: normalizedSearch, $options: 'i' } }
          ]
        }
      : {})
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.listAdmin, undefined, {
    count: items.length
  });

  return items.map(serializeMicroEducation);
};

export const createMicroEducation = async (
  context: MicroEducationServiceContext,
  input: CreateMicroEducationInput
): Promise<unknown> => {
  const item = await MicroEducationModel.create({
    ...input,
    createdBy: context.actor?.userId,
    updatedBy: context.actor?.userId
  });

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.create, item._id.toString(), {
    status: item.status
  });

  return serializeMicroEducation(item);
};

export const updateMicroEducation = async (
  context: MicroEducationServiceContext,
  id: string,
  input: UpdateMicroEducationInput
): Promise<unknown> => {
  const item = await MicroEducationModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education item not found');
  }

  item.set({
    ...input,
    updatedBy: context.actor?.userId
  });
  await item.save();

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.update, item._id.toString(), {
    changedFields: Object.keys(input)
  });

  return serializeMicroEducation(item);
};

export const deleteMicroEducation = async (
  context: MicroEducationServiceContext,
  id: string
): Promise<void> => {
  const item = await MicroEducationModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education item not found');
  }

  item.deletedAt = new Date();
  item.updatedBy = context.actor?.userId as never;
  await item.save();

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.delete, item._id.toString());
};
