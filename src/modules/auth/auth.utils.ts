import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';

import { env } from '@config/env';
import type { AuthenticatedUserPayload, AuthTokens } from './auth.types';

export const hashPassword = async (password: string): Promise<string> =>
  bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

export const verifyPassword = async (password: string, passwordHash: string): Promise<boolean> =>
  bcrypt.compare(password, passwordHash);

export const hashRefreshToken = async (refreshToken: string): Promise<string> =>
  bcrypt.hash(refreshToken, env.BCRYPT_SALT_ROUNDS);

export const verifyRefreshTokenHash = async (
  refreshToken: string,
  refreshTokenHash: string
): Promise<boolean> => bcrypt.compare(refreshToken, refreshTokenHash);

export const signAccessToken = (payload: AuthenticatedUserPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn']
  });

export const signRefreshToken = (payload: AuthenticatedUserPayload): string =>
  jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn']
  });

export const verifyAccessToken = (token: string): AuthenticatedUserPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthenticatedUserPayload;

export const verifyRefreshToken = (token: string): AuthenticatedUserPayload =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as AuthenticatedUserPayload;

export const buildAuthTokens = (payload: AuthenticatedUserPayload): AuthTokens => ({
  accessToken: signAccessToken(payload),
  refreshToken: signRefreshToken(payload)
});
