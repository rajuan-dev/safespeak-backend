import { env } from './env';

export const appConstants = {
  name: env.APP_NAME,
  version: env.APP_VERSION,
  apiPrefix: env.API_PREFIX,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test'
} as const;
