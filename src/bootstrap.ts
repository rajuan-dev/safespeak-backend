import mongoose from 'mongoose';

import { logger } from './common/utils/logger';
import { connectDatabase } from './config/database';
import {
  seedDefaultReportDestinations,
  seedDefaultSubmissionTemplates,
  seedDefaultSuperAdmin
} from './modules/admin/admin.seed';
import { seedDefaultTaxonomies } from './modules/taxonomies/taxonomies.seed';

let bootstrapPromise: Promise<void> | null = null;

const initializeApp = async (): Promise<void> => {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
    await connectDatabase();
  }

  await seedDefaultSuperAdmin();
  await seedDefaultReportDestinations();
  await seedDefaultSubmissionTemplates();
  await seedDefaultTaxonomies();
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
