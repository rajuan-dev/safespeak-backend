import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';

import {
  MEDIA_ASSET_ACTIONS,
  MEDIA_ASSET_ALLOWED_MIME_TYPES
} from './media-assets.constants';
import { MediaAssetModel, type MediaAssetDocument } from './media-assets.model';
import type {
  CreateMediaAssetInput,
  MediaAssetQueryInput,
  UpdateMediaAssetInput
} from './media-assets.schema';
import type { MediaAssetServiceContext } from './media-assets.types';

type UploadedFile = Express.Multer.File;

const mediaAssetRoot = path.resolve(env.MEDIA_ASSET_STORAGE_PATH);
const allowedMimeTypes = new Set<string>(MEDIA_ASSET_ALLOWED_MIME_TYPES);

const serializeMediaAsset = (asset: MediaAssetDocument | Record<string, unknown>) => {
  const raw = asset as MediaAssetDocument & { _id: { toString: () => string } };

  return {
    id: raw._id.toString(),
    title: raw.title,
    subtitle: raw.subtitle,
    bodyText: raw.bodyText,
    category: raw.category,
    status: raw.status,
    originalFileName: raw.originalFileName,
    mimeType: raw.mimeType,
    fileSizeBytes: raw.fileSizeBytes,
    imagePath: `/media-assets/${raw._id.toString()}/file`,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const auditMediaAssetAction = async (
  context: MediaAssetServiceContext,
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
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unsupported media file type. Upload a JPG or PNG image.');
  }

  if (file.size > env.MEDIA_ASSET_MAX_FILE_SIZE_BYTES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Media asset exceeds the 2MB limit.');
  }
};

const createStorageKey = (originalFileName: string): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const dateSegment = new Date().toISOString().slice(0, 10);

  return `${dateSegment}/${randomUUID()}${extension}`;
};

const getStoragePath = (storageKey: string): string => {
  const absolutePath = path.resolve(mediaAssetRoot, storageKey);

  if (!absolutePath.startsWith(mediaAssetRoot)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid media asset storage key');
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

const buildMediaAssetSearchQuery = (query: MediaAssetQueryInput, publicOnly: boolean) => {
  const normalizedSearch = query.search?.trim();

  return {
    deletedAt: { $exists: false },
    ...(publicOnly ? { status: 'published' } : query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(normalizedSearch
      ? {
          $or: [
            { title: { $regex: normalizedSearch, $options: 'i' } },
            { subtitle: { $regex: normalizedSearch, $options: 'i' } },
            { bodyText: { $regex: normalizedSearch, $options: 'i' } },
            { category: { $regex: normalizedSearch, $options: 'i' } },
            { originalFileName: { $regex: normalizedSearch, $options: 'i' } }
          ]
        }
      : {})
  };
};

export const listPublicMediaAssets = async (
  context: MediaAssetServiceContext,
  query: MediaAssetQueryInput
): Promise<unknown[]> => {
  const assets = await MediaAssetModel.find(buildMediaAssetSearchQuery(query, true))
    .sort({ createdAt: -1, title: 1 })
    .lean();

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.listPublic, undefined, {
    count: assets.length
  });

  return assets.map(serializeMediaAsset);
};

export const listAdminMediaAssets = async (
  context: MediaAssetServiceContext,
  query: MediaAssetQueryInput
): Promise<unknown[]> => {
  const assets = await MediaAssetModel.find(buildMediaAssetSearchQuery(query, false))
    .sort({ createdAt: -1, title: 1 })
    .lean();

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.listAdmin, undefined, {
    count: assets.length
  });

  return assets.map(serializeMediaAsset);
};

export const getAdminMediaAsset = async (
  context: MediaAssetServiceContext,
  id: string
): Promise<unknown> => {
  const asset = await MediaAssetModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!asset) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Media asset not found');
  }

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.getAdmin, id);

  return serializeMediaAsset(asset);
};

export const createMediaAsset = async (
  context: MediaAssetServiceContext,
  input: CreateMediaAssetInput,
  file?: UploadedFile
): Promise<unknown> => {
  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Media image is required');
  }

  const storageKey = await saveUploadedFile(file);
  const asset = await MediaAssetModel.create({
    ...input,
    originalFileName: file.originalname,
    storageKey,
    mimeType: file.mimetype,
    fileSizeBytes: file.size,
    createdBy: context.actor?.userId,
    updatedBy: context.actor?.userId
  });

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.create, asset._id.toString(), {
    category: input.category,
    status: input.status,
    fileSizeBytes: file.size
  });

  return serializeMediaAsset(asset);
};

export const updateMediaAsset = async (
  context: MediaAssetServiceContext,
  id: string,
  input: UpdateMediaAssetInput,
  file?: UploadedFile
): Promise<unknown> => {
  const asset = await MediaAssetModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!asset) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Media asset not found');
  }

  const updatePayload: Partial<MediaAssetDocument> = {
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

  asset.set(updatePayload);
  await asset.save();

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.update, asset._id.toString(), {
    changedFields: Object.keys(input),
    fileReplaced: Boolean(file)
  });

  return serializeMediaAsset(asset);
};

export const deleteMediaAsset = async (
  context: MediaAssetServiceContext,
  id: string
): Promise<void> => {
  const asset = await MediaAssetModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!asset) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Media asset not found');
  }

  asset.deletedAt = new Date();
  asset.updatedBy = context.actor?.userId as never;
  await asset.save();

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.delete, asset._id.toString());
};

export const getMediaAssetFile = async (
  context: MediaAssetServiceContext,
  id: string
): Promise<{
  stream: NodeJS.ReadableStream;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
}> => {
  const asset = await MediaAssetModel.findOne({
    _id: id,
    status: 'published',
    deletedAt: { $exists: false }
  });

  if (!asset) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Media asset not found');
  }

  const absolutePath = getStoragePath(asset.storageKey);
  await stat(absolutePath);

  await auditMediaAssetAction(context, MEDIA_ASSET_ACTIONS.view, id, {
    mimeType: asset.mimeType
  });

  return {
    stream: createReadStream(absolutePath),
    originalFileName: asset.originalFileName,
    mimeType: asset.mimeType,
    fileSizeBytes: asset.fileSizeBytes
  };
};
