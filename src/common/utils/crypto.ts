import crypto from 'node:crypto';

import { env } from '@config/env';

export const generateSecureToken = (byteLength = 32): string =>
  crypto.randomBytes(byteLength).toString('base64url');

export const hashSensitiveValue = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export const hashOptionalSensitiveValue = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  return hashSensitiveValue(value);
};

export const hashBuffer = (value: Buffer): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const deriveKey = (seed: string): Buffer => crypto.createHash('sha256').update(seed).digest();

export const encryptBuffer = (
  value: Buffer,
  keySeed = env.EVIDENCE_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET
): {
  encrypted: Buffer;
  iv: string;
  authTag: string;
} => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(keySeed), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);

  return {
    encrypted,
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url')
  };
};

export const decryptBuffer = (
  encrypted: Buffer,
  iv: string,
  authTag: string,
  keySeed = env.EVIDENCE_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET
): Buffer => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(keySeed),
    Buffer.from(iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

export const signPayload = (
  payload: string,
  keySeed = env.EVIDENCE_AUDIT_SIGNING_KEY ?? env.JWT_REFRESH_SECRET
): string => crypto.createHmac('sha256', keySeed).update(payload).digest('hex');
