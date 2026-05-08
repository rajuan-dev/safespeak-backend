import fs from 'node:fs/promises';
import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@config/env';
import { decryptBuffer, encryptBuffer, generateSecureToken } from '@common/utils/crypto';

import type { EvidenceDocument } from './evidence.model';
import type { StoredEvidenceFile } from './evidence.types';

const s3Client =
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.EVIDENCE_S3_BUCKET
    ? new S3Client({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY
        }
      })
    : undefined;

const storageRoot = path.resolve(env.EVIDENCE_LOCAL_STORAGE_PATH);

export const hasS3Storage = (): boolean => Boolean(s3Client && env.EVIDENCE_S3_BUCKET);

export const storeEncryptedLocalFile = async (
  reportId: string,
  fileBuffer: Buffer
): Promise<StoredEvidenceFile> => {
  const encryptedFile = encryptBuffer(fileBuffer);
  const reportDirectory = path.join(storageRoot, reportId);
  const filePath = path.join(reportDirectory, `${generateSecureToken(24)}.bin`);

  await fs.mkdir(reportDirectory, { recursive: true });
  await fs.writeFile(filePath, encryptedFile.encrypted, { flag: 'wx' });

  return {
    path: filePath,
    iv: encryptedFile.iv,
    authTag: encryptedFile.authTag
  };
};

export const readDecryptedLocalFile = async (evidence: EvidenceDocument): Promise<Buffer> => {
  if (!evidence.localEncryptedPath || !evidence.encryption.iv || !evidence.encryption.authTag) {
    throw new Error('Encrypted local evidence file is not available');
  }

  const encrypted = await fs.readFile(evidence.localEncryptedPath);

  return decryptBuffer(encrypted, evidence.encryption.iv, evidence.encryption.authTag);
};

export const removeLocalFileIfExists = async (filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};

export const syncEvidenceToS3 = async (
  evidence: EvidenceDocument
): Promise<{
  bucket: string;
  key: string;
  region: string;
  syncedAt: Date;
}> => {
  if (!s3Client || !env.EVIDENCE_S3_BUCKET) {
    throw new Error('S3 evidence storage is not configured');
  }

  if (!evidence.localEncryptedPath || !evidence.sha256Hash) {
    throw new Error('Evidence is not ready for S3 sync');
  }

  const encryptedFile = await fs.readFile(evidence.localEncryptedPath);
  const key = evidence.storageKey;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.EVIDENCE_S3_BUCKET,
      Key: key,
      Body: encryptedFile,
      ContentType: 'application/octet-stream',
      Metadata: {
        sha256Hash: evidence.sha256Hash,
        reportId: evidence.reportId.toString(),
        evidenceId: evidence._id.toString(),
        originalContentType: evidence.mimeType,
        encryption: evidence.encryption.algorithm
      },
      ServerSideEncryption: 'AES256'
    })
  );

  return {
    bucket: env.EVIDENCE_S3_BUCKET,
    key,
    region: env.AWS_REGION,
    syncedAt: new Date()
  };
};

export const createS3UploadUrl = async (
  storageKey: string,
  mimeType: string
): Promise<string | undefined> => {
  if (!s3Client || !env.EVIDENCE_S3_BUCKET) {
    return undefined;
  }

  return getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: env.EVIDENCE_S3_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256'
    }),
    { expiresIn: 900 }
  );
};
