import dns from 'node:dns';

import mongoose from 'mongoose';

import { logger } from '@common/utils/logger';

import { env } from './env';

export const connectDatabase = async (): Promise<typeof mongoose> => {
  try {
    if (env.MONGODB_DNS_SERVERS) {
      const servers = env.MONGODB_DNS_SERVERS.split(',')
        .map(server => server.trim())
        .filter(Boolean);

      if (servers.length > 0) {
        dns.setServers(servers);
        logger.info({ servers }, 'Custom MongoDB DNS servers configured');
      }
    }

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
