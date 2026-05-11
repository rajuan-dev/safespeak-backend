import mongoose from 'mongoose';

import { logger } from './common/utils/logger';
import { connectDatabase } from './config/database';
import { seedDefaultSuperAdmin } from './modules/admin/admin.seed';

let bootstrapPromise: Promise<void> | null = null;

const initializeApp = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
  }

  await seedDefaultSuperAdmin();
};

export const bootstrapApp = async (): Promise<void> => {
  if (!bootstrapPromise) {
    bootstrapPromise = initializeApp().catch((error: unknown) => {
      bootstrapPromise = null;
      logger.error({ error }, 'Application bootstrap failed');
      throw error;
    });
  }

  await bootstrapPromise;
};
