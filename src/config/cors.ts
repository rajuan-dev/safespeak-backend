import type { CorsOptions } from 'cors';

import { env } from './env';

const KNOWN_PRODUCTION_FRONTEND_ORIGINS = ['https://safespeak-frontend.vercel.app'];

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseConfiguredOrigins(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin));
}

const allowedOrigins = new Set(
  [
    env.CLIENT_URL,
    env.ADMIN_URL,
    ...KNOWN_PRODUCTION_FRONTEND_ORIGINS,
    ...parseConfiguredOrigins(env.CORS_ALLOWED_ORIGINS)
  ]
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin))
);

const allowAnyDevelopmentOrigin = env.NODE_ENV !== 'production';

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (allowAnyDevelopmentOrigin) {
      callback(null, true);
      return;
    }

    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = normalizeOrigin(origin);

    if (normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin is not allowed by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-SafeSpeak-Session']
};
