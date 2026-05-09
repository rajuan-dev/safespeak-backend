import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';

import { RESOURCE_ACTIONS } from './resources.constants';
import { ResourceModel, type ResourceDocument } from './resources.model';
import type {
  CreateResourceInput,
  ResourceAdminQueryInput,
  UpdateResourceInput
} from './resources.schema';
import type { ResourceServiceContext } from './resources.types';

const serializeResource = (resource: ResourceDocument | Record<string, unknown>) => {
  const raw = resource as ResourceDocument & { _id: { toString: () => string } };

  return {
    id: raw._id.toString(),
    name: raw.name,
    category: raw.category,
    region: raw.region,
    contact: raw.contact,
    status: raw.status,
    sortOrder: raw.sortOrder,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const auditResourceAction = async (
  context: ResourceServiceContext,
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

export const listPublicResources = async (
  context: ResourceServiceContext
): Promise<unknown[]> => {
  const resources = await ResourceModel.find({
    status: 'published',
    deletedAt: { $exists: false }
  })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  await auditResourceAction(context, RESOURCE_ACTIONS.listPublic, undefined, {
    count: resources.length
  });

  return resources.map(serializeResource);
};

export const listAdminResources = async (
  context: ResourceServiceContext,
  query: ResourceAdminQueryInput
): Promise<unknown[]> => {
  const normalizedSearch = query.search?.trim();
  const resources = await ResourceModel.find({
    deletedAt: { $exists: false },
    ...(query.status ? { status: query.status } : {}),
    ...(normalizedSearch
      ? {
          $or: [
            { name: { $regex: normalizedSearch, $options: 'i' } },
            { category: { $regex: normalizedSearch, $options: 'i' } },
            { region: { $regex: normalizedSearch, $options: 'i' } },
            { contact: { $regex: normalizedSearch, $options: 'i' } }
          ]
        }
      : {})
  })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  await auditResourceAction(context, RESOURCE_ACTIONS.listAdmin, undefined, {
    count: resources.length
  });

  return resources.map(serializeResource);
};

export const createResource = async (
  context: ResourceServiceContext,
  input: CreateResourceInput
): Promise<unknown> => {
  const resource = await ResourceModel.create({
    ...input,
    createdBy: context.actor?.userId,
    updatedBy: context.actor?.userId
  });

  await auditResourceAction(context, RESOURCE_ACTIONS.create, resource._id.toString(), {
    category: input.category,
    status: input.status
  });

  return serializeResource(resource);
};

export const updateResource = async (
  context: ResourceServiceContext,
  id: string,
  input: UpdateResourceInput
): Promise<unknown> => {
  const resource = await ResourceModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!resource) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Resource not found');
  }

  resource.set({
    ...input,
    updatedBy: context.actor?.userId
  });
  await resource.save();

  await auditResourceAction(context, RESOURCE_ACTIONS.update, resource._id.toString(), {
    changedFields: Object.keys(input)
  });

  return serializeResource(resource);
};

export const deleteResource = async (
  context: ResourceServiceContext,
  id: string
): Promise<void> => {
  const resource = await ResourceModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!resource) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Resource not found');
  }

  resource.deletedAt = new Date();
  resource.updatedBy = context.actor?.userId as never;
  await resource.save();

  await auditResourceAction(context, RESOURCE_ACTIONS.delete, resource._id.toString());
};
