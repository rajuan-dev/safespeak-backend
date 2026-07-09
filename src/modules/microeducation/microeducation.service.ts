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
import {
  deleteMicroEducationImageIfSafe,
  getMicroEducationImageDirectUrl,
  readMicroEducationImage,
  storeMicroEducationImage,
  type ReadMicroEducationImage
} from './microeducation.storage';
import type { MicroEducationServiceContext } from './microeducation.types';

type UploadedFile = Express.Multer.File;

const allowedImageMimeTypes = new Set<string>(MICRO_EDUCATION_ALLOWED_IMAGE_MIME_TYPES);

const serializeMicroEducation = async (
  item: MicroEducationDocument | Record<string, unknown>,
  options: { directS3ImageUrl?: boolean; versionProxyImagePath?: boolean } = {}
) => {
  const raw = item as MicroEducationDocument & { _id: { toString: () => string } };
  const proxyImagePath = getProxyMicroEducationImagePath(raw, options.versionProxyImagePath);
  const imagePath =
    raw.imageStorageKey && options.directS3ImageUrl
      ? (await getMicroEducationImageDirectUrl(raw)) ?? proxyImagePath
      : raw.imageStorageKey
        ? proxyImagePath
        : undefined;

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
    imagePath,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
};

const getProxyMicroEducationImagePath = (
  item: MicroEducationDocument & { _id: { toString: () => string } },
  includeVersion = false
): string => {
  const basePath = `/microeducation/${item._id.toString()}/image`;

  if (!includeVersion) {
    return basePath;
  }

  const version =
    item.updatedAt instanceof Date
      ? item.updatedAt.getTime().toString()
      : item.updatedAt
        ? new Date(item.updatedAt).getTime().toString()
        : item.imageStorageKey;

  return version ? `${basePath}?v=${encodeURIComponent(version)}` : basePath;
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

  return Promise.all(items.map(item => serializeMicroEducation(item, { directS3ImageUrl: true })));
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

  return Promise.all(items.map(item => serializeMicroEducation(item, { versionProxyImagePath: true })));
};

export const createMicroEducation = async (
  context: MicroEducationServiceContext,
  input: CreateMicroEducationInput,
  image?: UploadedFile
): Promise<unknown> => {
  const storedImage = image ? await saveMicroEducationImage(image) : undefined;
  const item = await MicroEducationModel.create({
    ...input,
    ...(storedImage
      ? {
          imageStorageProvider: storedImage.storageProvider,
          imageOriginalFileName: storedImage.originalFileName,
          imageStorageKey: storedImage.storageKey,
          imageMimeType: storedImage.mimeType,
          imageSizeBytes: storedImage.fileSizeBytes,
          imageS3Bucket: storedImage.bucket,
          imageS3Region: storedImage.region
        }
      : {}),
    createdBy: context.actor?.userId,
    updatedBy: context.actor?.userId
  });

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.create, item._id.toString(), {
    status: item.status
  });

  return serializeMicroEducation(item, { versionProxyImagePath: true });
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
    const previousImage = {
      imageS3Bucket: item.imageS3Bucket,
      imageStorageKey: item.imageStorageKey,
      imageStorageProvider: item.imageStorageProvider
    };
    const storedImage = await saveMicroEducationImage(image);

    updatePayload.imageStorageProvider = storedImage.storageProvider;
    updatePayload.imageOriginalFileName = storedImage.originalFileName;
    updatePayload.imageStorageKey = storedImage.storageKey;
    updatePayload.imageMimeType = storedImage.mimeType;
    updatePayload.imageSizeBytes = storedImage.fileSizeBytes;
    updatePayload.imageS3Bucket = storedImage.bucket;
    updatePayload.imageS3Region = storedImage.region;

    await item.set(updatePayload).save();

    if (previousImage.imageStorageProvider === 's3') {
      await deleteMicroEducationImageIfSafe(previousImage);
    }

    await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.update, item._id.toString(), {
      changedFields: Object.keys(input),
      imageReplaced: true
    });

    return serializeMicroEducation(item, { versionProxyImagePath: true });
  }

  item.set(updatePayload);
  await item.save();

  await auditMicroEducationAction(context, MICRO_EDUCATION_ACTIONS.update, item._id.toString(), {
    changedFields: Object.keys(input),
    imageReplaced: Boolean(image)
  });

  return serializeMicroEducation(item, { versionProxyImagePath: true });
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
): Promise<ReadMicroEducationImage> => {
  const item = await MicroEducationModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
  }

  return readMicroEducationImage(item);
};

const saveMicroEducationImage = async (file: UploadedFile) => {
  ensureSupportedImage(file);

  return storeMicroEducationImage(file);
};
