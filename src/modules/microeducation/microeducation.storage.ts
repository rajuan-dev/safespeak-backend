import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';

import type { MicroEducationDocument } from './microeducation.model';
import type { MicroEducationImageStorageProvider } from './microeducation.types';

export type StoredMicroEducationImage = {
  storageProvider: MicroEducationImageStorageProvider;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  bucket?: string;
  region?: string;
};

export type ReadMicroEducationImage = {
  stream: NodeJS.ReadableStream;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
};

type UploadedImageFile = Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'originalname' | 'size'>;

const microEducationImageRoot = path.resolve(env.MICRO_EDUCATION_IMAGE_STORAGE_PATH);
const s3Client =
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.MICRO_EDUCATION_S3_BUCKET
    ? new S3Client({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY
        }
      })
    : undefined;

export const hasMicroEducationS3Storage = (): boolean =>
  Boolean(s3Client && env.MICRO_EDUCATION_S3_BUCKET);

const SIGNED_IMAGE_URL_EXPIRES_SECONDS = 60 * 60;

const normalizePrefix = (value: string): string =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');

export const buildMicroEducationImageStorageKey = (originalFileName: string): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const dateSegment = new Date().toISOString().slice(0, 10);
  const objectName = `${dateSegment}/${randomUUID()}${extension}`;
  const prefix = normalizePrefix(env.MICRO_EDUCATION_S3_PREFIX);

  return prefix ? `${prefix}/${objectName}` : objectName;
};

const getLocalStoragePath = (storageKey: string): string => {
  const absolutePath = path.resolve(microEducationImageRoot, storageKey);

  if (!absolutePath.startsWith(microEducationImageRoot)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid micro-education image storage key');
  }

  return absolutePath;
};

const toLegacyLocalStorageKey = (storageKey: string): string => {
  const prefix = `${normalizePrefix(env.MICRO_EDUCATION_S3_PREFIX)}/`;

  return prefix && storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : storageKey;
};

const isMissingS3ObjectError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (('name' in error && ['NoSuchKey', 'NotFound'].includes(String(error.name))) ||
    ('$metadata' in error &&
      typeof error.$metadata === 'object' &&
      error.$metadata !== null &&
      'httpStatusCode' in error.$metadata &&
      error.$metadata.httpStatusCode === 404));

const storeLocalMicroEducationImage = async (
  file: UploadedImageFile
): Promise<StoredMicroEducationImage> => {
  const storageKey = buildMicroEducationImageStorageKey(file.originalname);
  const localStorageKey = toLegacyLocalStorageKey(storageKey);
  const absolutePath = getLocalStoragePath(localStorageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer);

  return {
    storageProvider: 'local',
    storageKey: localStorageKey,
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    fileSizeBytes: file.size
  };
};

const storeS3MicroEducationImage = async (
  file: UploadedImageFile
): Promise<StoredMicroEducationImage> => {
  if (!s3Client || !env.MICRO_EDUCATION_S3_BUCKET) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'S3 micro-education storage is not configured');
  }

  const storageKey = buildMicroEducationImageStorageKey(file.originalname);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.MICRO_EDUCATION_S3_BUCKET,
      Key: storageKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'AES256'
    })
  );

  return {
    storageProvider: 's3',
    storageKey,
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    fileSizeBytes: file.size,
    bucket: env.MICRO_EDUCATION_S3_BUCKET,
    region: env.AWS_REGION
  };
};

export const storeMicroEducationImage = async (
  file: UploadedImageFile
): Promise<StoredMicroEducationImage> =>
  hasMicroEducationS3Storage()
    ? storeS3MicroEducationImage(file)
    : storeLocalMicroEducationImage(file);

export const readMicroEducationImage = async (
  item: Pick<
    MicroEducationDocument,
    | 'imageMimeType'
    | 'imageOriginalFileName'
    | 'imageS3Bucket'
    | 'imageSizeBytes'
    | 'imageStorageKey'
    | 'imageStorageProvider'
  >
): Promise<ReadMicroEducationImage> => {
  if (!item.imageStorageKey || !item.imageMimeType || !item.imageSizeBytes) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
  }

  if (item.imageStorageProvider === 's3') {
    if (!s3Client) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
    }

    const bucket = item.imageS3Bucket ?? env.MICRO_EDUCATION_S3_BUCKET;

    if (!bucket) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
    }

    let object;

    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: item.imageStorageKey
        })
      );

      object = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: item.imageStorageKey
        })
      );
    } catch (error) {
      if (isMissingS3ObjectError(error)) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
      }

      throw error;
    }

    if (!object.Body || !(object.Body instanceof Readable)) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Micro-education image not found');
    }

    return {
      stream: object.Body,
      originalFileName: item.imageOriginalFileName ?? 'micro-education-image',
      mimeType: object.ContentType ?? item.imageMimeType,
      fileSizeBytes: object.ContentLength ?? item.imageSizeBytes
    };
  }

  const absolutePath = getLocalStoragePath(item.imageStorageKey);
  await stat(absolutePath);

  return {
    stream: createReadStream(absolutePath),
    originalFileName: item.imageOriginalFileName ?? 'micro-education-image',
    mimeType: item.imageMimeType,
    fileSizeBytes: item.imageSizeBytes
  };
};

export const getMicroEducationImageDirectUrl = async (
  item: Pick<
    MicroEducationDocument,
    'imageS3Bucket' | 'imageStorageKey' | 'imageStorageProvider'
  >
): Promise<string | undefined> => {
  if (item.imageStorageProvider !== 's3' || !item.imageStorageKey) {
    return undefined;
  }

  if (env.MICRO_EDUCATION_CDN_BASE_URL) {
    return `${env.MICRO_EDUCATION_CDN_BASE_URL.replace(/\/+$/, '')}/${item.imageStorageKey
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/')}`;
  }

  if (!s3Client) {
    return undefined;
  }

  const bucket = item.imageS3Bucket ?? env.MICRO_EDUCATION_S3_BUCKET;

  if (!bucket) {
    return undefined;
  }

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: item.imageStorageKey
    }),
    { expiresIn: SIGNED_IMAGE_URL_EXPIRES_SECONDS }
  );
};

export const deleteMicroEducationImageIfSafe = async (
  item: Pick<MicroEducationDocument, 'imageS3Bucket' | 'imageStorageKey' | 'imageStorageProvider'>
): Promise<void> => {
  if (!item.imageStorageKey) {
    return;
  }

  if (item.imageStorageProvider === 's3') {
    if (!s3Client) {
      return;
    }

    const bucket = item.imageS3Bucket ?? env.MICRO_EDUCATION_S3_BUCKET;

    if (!bucket) {
      return;
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: item.imageStorageKey
      })
    );
    return;
  }

  try {
    await unlink(getLocalStoragePath(item.imageStorageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};
