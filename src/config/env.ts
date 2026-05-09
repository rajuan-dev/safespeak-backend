import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = (schema: z.ZodString) =>
  z.preprocess(emptyStringToUndefined, schema.optional());

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return value;
}, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_NAME: z.string().min(1).default('SafeSpeak Backend'),
    APP_VERSION: z.string().min(1).default('1.0.0'),
    API_PREFIX: z.string().startsWith('/').default('/api/v1'),
    CLIENT_URL: z.string().url().default('http://localhost:3000'),
    ADMIN_URL: z.string().url().default('http://localhost:5173'),
    MONGODB_URI: z.string().min(1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    EVIDENCE_LOCAL_STORAGE_PATH: z.string().min(1).default('./storage/evidence'),
    EVIDENCE_ENCRYPTION_KEY: optionalString(z.string().min(32)),
    EVIDENCE_AUDIT_SIGNING_KEY: optionalString(z.string().min(32)),
    EVIDENCE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10485760),
    OPENAI_API_KEY: optionalString(z.string().min(1)),
    OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    RAG_VECTOR_INDEX: z.string().min(1).default('rag_chunks_vector_index'),
    AWS_REGION: z.string().min(1).default('ap-southeast-2'),
    AWS_ACCESS_KEY_ID: optionalString(z.string().min(1)),
    AWS_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
    EVIDENCE_S3_BUCKET: optionalString(z.string().min(1)),
    EVIDENCE_S3_PREFIX: z.string().min(1).default('evidence-vault'),
    ENABLE_ADMIN_SEED: booleanFromString.default(true),
    DEFAULT_SUPER_ADMIN_EMAIL: optionalString(z.string().email()),
    DEFAULT_SUPER_ADMIN_PASSWORD: optionalString(z.string().min(12)),
    DEFAULT_SUPER_ADMIN_FULL_NAME: z.string().min(1).default('SafeSpeak Super Admin')
  })
  .superRefine((value, context) => {
    if (!value.ENABLE_ADMIN_SEED) {
      return;
    }

    if (!value.DEFAULT_SUPER_ADMIN_EMAIL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DEFAULT_SUPER_ADMIN_EMAIL is required when ENABLE_ADMIN_SEED=true',
        path: ['DEFAULT_SUPER_ADMIN_EMAIL']
      });
    }

    if (!value.DEFAULT_SUPER_ADMIN_PASSWORD) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DEFAULT_SUPER_ADMIN_PASSWORD is required when ENABLE_ADMIN_SEED=true',
        path: ['DEFAULT_SUPER_ADMIN_PASSWORD']
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;

export type Env = typeof env;
