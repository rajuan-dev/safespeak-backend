import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_NAME: z.string().min(1).default('SafeSpeak Backend'),
  APP_VERSION: z.string().min(1).default('1.0.0'),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  CLIENT_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  EVIDENCE_LOCAL_STORAGE_PATH: z.string().min(1).default('./storage/evidence'),
  EVIDENCE_ENCRYPTION_KEY: z.string().min(32).optional(),
  EVIDENCE_AUDIT_SIGNING_KEY: z.string().min(32).optional(),
  EVIDENCE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10485760),
  AWS_REGION: z.string().min(1).default('ap-southeast-2'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  EVIDENCE_S3_BUCKET: z.string().min(1).optional(),
  EVIDENCE_S3_PREFIX: z.string().min(1).default('evidence-vault')
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;

export type Env = typeof env;
