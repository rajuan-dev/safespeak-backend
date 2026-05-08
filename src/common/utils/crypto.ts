import crypto from 'node:crypto';

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
