import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { env } from '@config/env';

import {
  CONTENT_RESOURCE_ACTIONS,
  CONTENT_RESOURCE_ALLOWED_MIME_TYPES
} from './content-resources.constants';
import {
  ContentResourceModel,
  type ContentResourceDocument
} from './content-resources.model';
import type {
  ContentResourceQueryInput,
  CreateContentResourceInput,
  UpdateContentResourceInput
} from './content-resources.schema';
import type { ContentResourceServiceContext } from './content-resources.types';

type UploadedFile = Express.Multer.File;

const contentResourceRoot = path.resolve(env.CONTENT_RESOURCE_STORAGE_PATH);

const allowedMimeTypes = new Set<string>(CONTENT_RESOURCE_ALLOWED_MIME_TYPES);

const getDisplayStatus = (resource: Pick<ContentResourceDocument, 'reviewDate' | 'status'>) => {
  if (resource.status === 'draft') {
    return 'Draft';
  }

  if (resource.status === 'archived') {
    return 'Archived';
  }

  if (!resource.reviewDate) {
    return 'Active';
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reviewDate = new Date(resource.reviewDate);
  reviewDate.setHours(0, 0, 0, 0);

  if (reviewDate.getTime() < today.getTime()) {
    return 'Outdated';
  }

  const fortyFiveDaysInMs = 45 * 24 * 60 * 60 * 1000;

  if (reviewDate.getTime() - today.getTime() <= fortyFiveDaysInMs) {
    return 'Expiring Soon';
  }

  return 'Active';
};

const serializeContentResource = (resource: ContentResourceDocument | Record<string, unknown>) => {
  const raw = resource as ContentResourceDocument & { _id: { toString: () => string } };

  return {
    id: raw._id.toString(),
    name: raw.name,
    language: raw.language,
    category: raw.category,
    jurisdiction: raw.jurisdiction,
    reviewDate: raw.reviewDate,
    status: raw.status,
    displayStatus: getDisplayStatus(raw),
    originalFileName: raw.originalFileName,
    mimeType: raw.mimeType,
    fileSizeBytes: raw.fileSizeBytes,
    downloadPath: `/content-resources/${raw._id.toString()}/download`,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const auditContentResourceAction = async (
  context: ContentResourceServiceContext,
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

const ensureSupportedFile = (file: UploadedFile): void => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Unsupported resource file type. Upload a PDF, MP3, or MP4 file.'
    );
  }

  if (file.size > env.CONTENT_RESOURCE_MAX_FILE_SIZE_BYTES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Resource file exceeds the 50MB limit.');
  }
};

const createStorageKey = (originalFileName: string): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const dateSegment = new Date().toISOString().slice(0, 10);

  return `${dateSegment}/${randomUUID()}${extension}`;
};

const getStoragePath = (storageKey: string): string => {
  const absolutePath = path.resolve(contentResourceRoot, storageKey);

  if (!absolutePath.startsWith(contentResourceRoot)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid resource storage key');
  }

  return absolutePath;
};

const saveUploadedFile = async (file: UploadedFile): Promise<string> => {
  ensureSupportedFile(file);

  const storageKey = createStorageKey(file.originalname);
  const absolutePath = getStoragePath(storageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer);

  return storageKey;
};

const buildResourceSearchQuery = (query: ContentResourceQueryInput, publicOnly: boolean) => {
  const normalizedSearch = query.search?.trim();

  return {
    deletedAt: { $exists: false },
    ...(publicOnly ? { status: 'published' } : query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(normalizedSearch
      ? {
          $or: [
            { name: { $regex: normalizedSearch, $options: 'i' } },
            { language: { $regex: normalizedSearch, $options: 'i' } },
            { category: { $regex: normalizedSearch, $options: 'i' } },
            { jurisdiction: { $regex: normalizedSearch, $options: 'i' } },
            { originalFileName: { $regex: normalizedSearch, $options: 'i' } }
          ]
        }
      : {})
  };
};

export const listPublicContentResources = async (
  context: ContentResourceServiceContext,
  query: ContentResourceQueryInput
): Promise<unknown[]> => {
  const resources = await ContentResourceModel.find(buildResourceSearchQuery(query, true))
    .sort({ reviewDate: 1, name: 1 })
    .lean();

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.listPublic, undefined, {
    count: resources.length
  });

  return resources.map(serializeContentResource);
};

export const listAdminContentResources = async (
  context: ContentResourceServiceContext,
  query: ContentResourceQueryInput
): Promise<unknown[]> => {
  const resources = await ContentResourceModel.find(buildResourceSearchQuery(query, false))
    .sort({ createdAt: -1, name: 1 })
    .lean();

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.listAdmin, undefined, {
    count: resources.length
  });

  return resources.map(serializeContentResource);
};

export const getAdminContentResource = async (
  context: ContentResourceServiceContext,
  id: string
): Promise<unknown> => {
  const resource = await ContentResourceModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!resource) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Content resource not found');
  }

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.getAdmin, id);

  return serializeContentResource(resource);
};

export const createContentResource = async (
  context: ContentResourceServiceContext,
  input: CreateContentResourceInput,
  file?: UploadedFile
): Promise<unknown> => {
  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Resource file is required');
  }

  const storageKey = await saveUploadedFile(file);
  const resource = await ContentResourceModel.create({
    ...input,
    originalFileName: file.originalname,
    storageKey,
    mimeType: file.mimetype,
    fileSizeBytes: file.size,
    createdBy: context.actor?.userId,
    updatedBy: context.actor?.userId
  });

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.create, resource._id.toString(), {
    category: input.category,
    status: input.status,
    fileSizeBytes: file.size
  });

  return serializeContentResource(resource);
};

export const updateContentResource = async (
  context: ContentResourceServiceContext,
  id: string,
  input: UpdateContentResourceInput,
  file?: UploadedFile
): Promise<unknown> => {
  const resource = await ContentResourceModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!resource) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Content resource not found');
  }

  const updatePayload: Partial<ContentResourceDocument> = {
    ...input,
    updatedBy: context.actor?.userId as never
  };

  if (file) {
    const storageKey = await saveUploadedFile(file);
    updatePayload.originalFileName = file.originalname;
    updatePayload.storageKey = storageKey;
    updatePayload.mimeType = file.mimetype;
    updatePayload.fileSizeBytes = file.size;
  }

  resource.set(updatePayload);
  await resource.save();

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.update, resource._id.toString(), {
    changedFields: Object.keys(input),
    fileReplaced: Boolean(file)
  });

  return serializeContentResource(resource);
};

export const deleteContentResource = async (
  context: ContentResourceServiceContext,
  id: string
): Promise<void> => {
  const resource = await ContentResourceModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!resource) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Content resource not found');
  }

  resource.deletedAt = new Date();
  resource.updatedBy = context.actor?.userId as never;
  await resource.save();

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.delete, resource._id.toString());
};

export const getContentResourceDownload = async (
  context: ContentResourceServiceContext,
  id: string
): Promise<{
  stream: NodeJS.ReadableStream;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
}> => {
  const resource = await ContentResourceModel.findOne({
    _id: id,
    status: 'published',
    deletedAt: { $exists: false }
  });

  if (!resource) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Content resource not found');
  }

  const absolutePath = getStoragePath(resource.storageKey);
  await stat(absolutePath);

  await auditContentResourceAction(context, CONTENT_RESOURCE_ACTIONS.download, id, {
    mimeType: resource.mimeType
  });

  return {
    stream: createReadStream(absolutePath),
    originalFileName: resource.originalFileName,
    mimeType: resource.mimeType,
    fileSizeBytes: resource.fileSizeBytes
  };
};
