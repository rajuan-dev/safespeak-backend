import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import { createAuditLog } from '@modules/audit/audit.service';
import { callAiAgentJson } from '@modules/ai/ai-agent.client';

import {
  MICRO_EDUCATION_ACTIONS,
  MICRO_EDUCATION_ALLOWED_IMAGE_MIME_TYPES
} from './microeducation.constants';
import { MicroEducationCategoryModel } from './microeducation-category.model';
import { MicroEducationModel, type MicroEducationDocument } from './microeducation.model';
import type {
  CreateMicroEducationInput,
  GenerateMicroEducationInput,
  MicroEducationAdminQueryInput,
  MicroEducationPublicQueryInput,
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

const generatedCardDefaults = {
  readTimeLabel: '4 min read',
  tag: 'Safety',
  cta: 'Start Now',
  tone: 'blue' as const,
  chips: ['safety'] as const,
  incidentCategories: [] as string[],
  matchKeywords: [] as string[],
  duration: 'quick' as const,
  format: 'guide' as const,
  status: 'draft' as const,
  sortOrder: 0,
  views: 0
};

const serializeMicroEducation = async (
  item: MicroEducationDocument | Record<string, unknown>,
  options: { directS3ImageUrl?: boolean; versionProxyImagePath?: boolean } = {}
) => {
  const raw = item as MicroEducationDocument & {
    _id: { toString: () => string };
    categoryId?: { toString: () => string } | Record<string, unknown>;
    category?: Record<string, unknown>;
  };
  const populatedCategory =
    raw.categoryId &&
    typeof raw.categoryId === 'object' &&
    'name' in raw.categoryId
      ? (raw.categoryId as Record<string, unknown> & { _id?: { toString: () => string } })
      : raw.category;
  const categoryId =
    raw.categoryId && typeof raw.categoryId === 'object' && 'name' in raw.categoryId
      ? (raw.categoryId as { _id?: { toString: () => string } })._id?.toString()
      : raw.categoryId?.toString();
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
    categoryId,
    category: populatedCategory
      ? {
          id:
            (populatedCategory._id as { toString?: () => string } | undefined)?.toString?.() ??
            categoryId,
          name: populatedCategory.name,
          description: populatedCategory.description,
          backgroundColor: populatedCategory.backgroundColor,
          textColor: populatedCategory.textColor,
          iconName: populatedCategory.iconName,
          imageUrl: populatedCategory.imageUrl,
          status: populatedCategory.status,
          sortOrder: populatedCategory.sortOrder
        }
      : undefined,
    tone: raw.tone,
    chips: raw.chips,
    incidentCategories: raw.incidentCategories ?? [],
    matchKeywords: raw.matchKeywords ?? [],
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
  context: MicroEducationServiceContext,
  query: MicroEducationPublicQueryInput = {}
): Promise<unknown[]> => {
  const items = await MicroEducationModel.find({
    status: 'published',
    deletedAt: { $exists: false },
    ...(query.categoryId ? { categoryId: query.categoryId } : {})
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
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
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

export const generateMicroEducationCard = async (
  context: MicroEducationServiceContext,
  input: GenerateMicroEducationInput
): Promise<Record<string, unknown>> => {
  const generated = await callAiAgentJson<Record<string, unknown>>({
    model: env.OPENAI_MODEL,
    systemPrompt: [
      'You create one SafeSpeak micro-education card for people seeking safety guidance.',
      'Return only JSON with title, summary, detailHeading, detailSummary, detailBody, detailTakeaway, tag, cta, readTimeLabel, chips, incidentCategories, matchKeywords, duration, format, and tone.',
      'Use plain, trauma-aware, non-judgmental language. Do not provide legal conclusions, invent services, or include unsupported statistics.',
      'Keep the summary under 240 characters, detailSummary under 500 characters, detailBody under 1800 characters, and detailTakeaway under 240 characters.',
      'Use chips from harassment, rights, safety, mentalHealth; duration quick or deep; format guide, interactive, or video; tone blue, orange, green, amber, violet, or teal.'
    ].join(' '),
    userPrompt: JSON.stringify({ topic: input.topic, audience: input.audience, language: input.language })
  });

  const text = (key: string, fallback: string): string =>
    typeof generated[key] === 'string' && generated[key].trim()
      ? generated[key].trim()
      : fallback;
  const list = (key: string, fallback: readonly string[], max: number): string[] => {
    const value = generated[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, max)
      : [...fallback];
  };
  const allowedChips = new Set(['harassment', 'rights', 'safety', 'mentalHealth']);
  const chips = list('chips', generatedCardDefaults.chips, 4).filter(chip => allowedChips.has(chip));

  const card = {
    ...generatedCardDefaults,
    title: text('title', input.topic),
    summary: text('summary', `Practical guidance about ${input.topic}.`),
    detailHeading: text('detailHeading', text('title', input.topic)),
    detailSummary: text('detailSummary', text('summary', `Practical guidance about ${input.topic}.`)),
    detailBody: text('detailBody', `Learn about ${input.topic}, consider what feels safe for you, and choose one practical next step.`),
    detailTakeaway: text('detailTakeaway', 'Choose the next step that feels safest and most manageable right now.'),
    tag: text('tag', generatedCardDefaults.tag),
    cta: text('cta', generatedCardDefaults.cta),
    readTimeLabel: text('readTimeLabel', generatedCardDefaults.readTimeLabel),
    chips: chips.length ? chips : [...generatedCardDefaults.chips],
    incidentCategories: list('incidentCategories', generatedCardDefaults.incidentCategories, 5),
    matchKeywords: list('matchKeywords', [input.topic], 12),
    duration: generated.duration === 'deep' ? 'deep' : generatedCardDefaults.duration,
    format:
      generated.format === 'interactive' || generated.format === 'video'
        ? generated.format
        : generatedCardDefaults.format,
    tone:
      ['blue', 'orange', 'green', 'amber', 'violet', 'teal'].includes(generated.tone as string)
        ? (generated.tone as typeof input.tone)
        : input.tone,
    categoryId: input.categoryId
  };

  await auditMicroEducationAction(context, 'microeducation.generate', undefined, {
    topic: input.topic,
    language: input.language
  });

  return card;
};

export const createMicroEducation = async (
  context: MicroEducationServiceContext,
  input: CreateMicroEducationInput,
  image?: UploadedFile
): Promise<unknown> => {
  const storedImage = image ? await saveMicroEducationImage(image) : undefined;
  const categoryId = await resolveMicroEducationCategoryId(input.categoryId);
  const item = await MicroEducationModel.create({
    ...input,
    categoryId,
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

  const { categoryId: inputCategoryId, ...cardInput } = input;
  const categoryId =
    inputCategoryId !== undefined
      ? await resolveMicroEducationCategoryId(inputCategoryId)
      : undefined;
  const updatePayload: Partial<MicroEducationDocument> = {
    ...cardInput,
    ...(categoryId ? { categoryId } : {}),
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

const resolveMicroEducationCategoryId = async (categoryId?: string) => {
  if (!categoryId) {
    return undefined;
  }

  const category = await MicroEducationCategoryModel.findOne({
    _id: categoryId,
    deletedAt: { $exists: false }
  });

  if (!category) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Micro-education category not found');
  }

  return category._id;
};
