import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';

import {
  MICRO_EDUCATION_ACTIONS,
  MICRO_EDUCATION_ALLOWED_IMAGE_MIME_TYPES
} from './microeducation.constants';
import { MicroEducationModel, type MicroEducationDocument } from './microeducation.model';
import type {
  CreateMicroEducationInput,
  MicroEducationAdminQueryInput,
  UpdateMicroEducationInput
} from './microeducation.schema';
import type { MicroEducationServiceContext } from './microeducation.types';

type UploadedFile = Express.Multer.File;

const microEducationImageRoot = path.resolve(env.MICRO_EDUCATION_IMAGE_STORAGE_PATH);
const allowedImageMimeTypes = new Set<string>(MICRO_EDUCATION_ALLOWED_IMAGE_MIME_TYPES);

const serializeMicroEducation = (item: MicroEducationDocument | Record<string, unknown>) => {
  const raw = item as MicroEducationDocument & { _id: { toString: () => string } };

  return {
    id: raw._id.toString(),
    title: raw.title,
    summary: raw.summary,
    readTimeLabel: raw.readTimeLabel ?? '4 min read',
    tag: raw.tag,
    cta: raw.cta,
    detailHeading: raw.detailHeading ?? 'Safety overview',
    detailSummary: raw.detailSummary,
    detailBody:
      raw.detailBody ??
      'Review the guidance and choose the next safe step that fits your situation.',
    detailTakeaway: raw.detailTakeaway ?? 'Keep notes simple, factual, and stored somewhere safe.',
    imageAlt: raw.imageAlt,
    tone: raw.tone,
    chips: raw.chips,
    duration: raw.duration,
    format: raw.format,
    status: raw.status,
    sortOrder: raw.sortOrder,
    views: raw.views,
    imageOriginalFileName: raw.imageOriginalFileName,
    imageMimeType: raw.imageMimeType,
    imageSizeBytes: raw.imageSizeBytes,
    imagePath: raw.imageStorageKey ? `/microeducation/${raw._id.toString()}/image` : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const ensureSupportedImage = (file: UploadedFile): void => {
  if (!allowedImageMimeTypes.has(file.mimetype)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Unsupported micro-education image type. Upload a JPG, PNG, WebP, or GIF image.'
    );
  }

  if (file.size > env.MICRO_EDUCATION_IMAGE_MAX_FILE_SIZE_BYTES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Micro-education image exceeds the 10MB limit.');
  }
};

const createStorageKey = (originalFileName: string): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const dateSegment = new Date().toISOString().slice(0, 10);

  return `${dateSegment}/${randomUUID()}${extension}`;
};

const getStoragePath = (storageKey: string): string => {
  const absolutePath = path.resolve(microEducationImageRoot, storageKey);

  if (!absolutePath.startsWith(microEducationImageRoot)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid micro-education image storage key');
  }

  return absolutePath;
};

const saveUploadedImage = async (file: UploadedFile): Promise<string> => {
  ensureSupportedImage(file);

  const storageKey = createStorageKey(file.originalname);
  const absolutePath = getStoragePath(storageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer);

  return storageKey;
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
            { tag: { $regex: normalizedSearch, $options: 'i' } },
            { imageOriginalFileName: { $regex: normalizedSearch, $options: 'i' } }
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
  input: CreateMicroEducationInput,
  image?: UploadedFile
): Promise<unknown> => {
  const imageStorageKey = image ? await saveUploadedImage(image) : undefined;
  const item = await MicroEducationModel.create({
    ...input,
    ...(image
      ? {
          imageOriginalFileName: image.originalname,
          imageStorageKey,
          imageMimeType: image.mimetype,
          imageSizeBytes: image.size
        }
      : {}),
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
  input: UpdateMicroEducationInput,
  image?: UploadedFile
): Promise<unknown> => {
  const item = await MicroEducationModel.findOne({ _id: id, deletedAt: { $exists: false } });

  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education item not found');
  }

  const updatePayload: Partial<MicroEducationDocument> = {
    ...input,
    updatedBy: context.actor?.userId as never
  };

  if (image) {
    const imageStorageKey = await saveUploadedImage(image);
    updatePayload.imageOriginalFileName = image.originalname;
    updatePayload.imageStorageKey = imageStorageKey;
    updatePayload.imageMimeType = image.mimetype;
    updatePayload.imageSizeBytes = image.size;
  }

  item.set(updatePayload);
  await item.save();

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.update, item._id.toString(), {
    changedFields: Object.keys(input),
    imageReplaced: Boolean(image)
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

export const getMicroEducationImage = async (
  _context: MicroEducationServiceContext,
  id: string
): Promise<{
  stream: NodeJS.ReadableStream;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
}> => {
  const item = await MicroEducationModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!item?.imageStorageKey || !item.imageMimeType || !item.imageSizeBytes) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
  }

  const absolutePath = getStoragePath(item.imageStorageKey);
  await stat(absolutePath);

  return {
    stream: createReadStream(absolutePath),
    originalFileName: item.imageOriginalFileName ?? 'micro-education-image',
    mimeType: item.imageMimeType,
    fileSizeBytes: item.imageSizeBytes
  };
};
