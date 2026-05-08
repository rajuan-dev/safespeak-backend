import mongoose from 'mongoose';

import { logger } from '@common/utils/logger';

import { env } from './env';

export const connectDatabase = async (): Promise<typeof mongoose> => {
  try {
    const connection = await mongoose.connect(env.MONGODB_URI, {
      autoIndex: env.NODE_ENV !== 'production'
    });

    logger.info(
      {
        host: connection.connection.host,
        name: connection.connection.name
      },
      'MongoDB connected'
    );

    return connection;
  } catch (error) {
    logger.error({ error }, 'MongoDB connection failed');
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
};
