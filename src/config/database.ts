import dns from 'node:dns';

import mongoose from 'mongoose';

import { logger } from '@common/utils/logger';

import { env } from './env';

type DnsOverHttpsAnswer = {
  data?: string;
};

type DnsOverHttpsResponse = {
  Answer?: DnsOverHttpsAnswer[];
};

const ATLAS_DEFAULT_OPTIONS = {
  tls: 'true'
};

const buildMongoUriFromSrvFallback = async (mongoUri: string): Promise<string> => {
  const parsedUri = new URL(mongoUri);
  const hostname = parsedUri.hostname;
  const pathname = parsedUri.pathname.startsWith('/') ? parsedUri.pathname.slice(1) : parsedUri.pathname;
  const srvRecords = await resolveDnsOverHttps(`_mongodb._tcp.${hostname}`, 'SRV');
  const txtRecords = await resolveDnsOverHttps(hostname, 'TXT');

  if (srvRecords.length === 0) {
    throw new Error(`No SRV records found for ${hostname}`);
  }

  const hosts = srvRecords
    .map(record => record.trim().split(/\s+/))
    .filter(parts => parts.length >= 4)
    .map(parts => {
      const port = parts[2];
      const target = parts[3].replace(/\.$/, '');

      return `${target}:${port}`;
    });

  if (hosts.length === 0) {
    throw new Error(`Unable to parse SRV records for ${hostname}`);
  }

  const params = new URLSearchParams(parsedUri.search);

  Object.entries(ATLAS_DEFAULT_OPTIONS).forEach(([key, value]) => {
    if (!params.has(key)) {
      params.set(key, value);
    }
  });

  for (const record of txtRecords) {
    const normalized = record.replace(/^"|"$/g, '').replace(/"\s+"/g, '&');

    for (const [key, value] of new URLSearchParams(normalized).entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }

  const credentials = parsedUri.username
    ? `${parsedUri.username}${parsedUri.password ? `:${parsedUri.password}` : ''}@`
    : '';
  const query = params.toString();

  return `mongodb://${credentials}${hosts.join(',')}/${pathname}${query ? `?${query}` : ''}`;
};

const resolveDnsOverHttps = async (name: string, type: 'SRV' | 'TXT'): Promise<string[]> => {
  const providers = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  ];

  for (const provider of providers) {
    try {
      const response = await fetch(provider, {
        headers: {
          Accept: 'application/dns-json'
        }
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as DnsOverHttpsResponse;
      const answers = payload.Answer?.map(answer => answer.data?.trim()).filter(Boolean) as string[] | undefined;

      if (answers && answers.length > 0) {
        return answers;
      }
    } catch (error) {
      logger.warn({ error, provider, name, type }, 'DNS-over-HTTPS lookup failed');
    }
  }

  return [];
};

export const connectDatabase = async (): Promise<typeof mongoose> => {
  try {
    if (env.MONGODB_DNS_SERVERS) {
      const servers = env.MONGODB_DNS_SERVERS.split(',')
        .map(server => server.trim())
        .filter(Boolean);
      const isSrvConnection = env.MONGODB_URI.startsWith('mongodb+srv://');

      if (servers.length > 0) {
        if (isSrvConnection) {
          logger.warn(
            { servers },
            'Ignoring custom MongoDB DNS servers for mongodb+srv URI; using system DNS for Atlas SRV lookup'
          );
        } else {
          dns.setServers(servers);
          logger.info({ servers }, 'Custom MongoDB DNS servers configured');
        }
      }
    }

    let connection: typeof mongoose;

    try {
      connection = await mongoose.connect(env.MONGODB_URI, {
        autoIndex: env.NODE_ENV !== 'production'
      });
    } catch (error) {
      const isSrvConnection = env.MONGODB_URI.startsWith('mongodb+srv://');
      const isSrvLookupFailure =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'syscall' in error &&
        error.code === 'ECONNREFUSED' &&
        error.syscall === 'querySrv';

      if (!isSrvConnection || !isSrvLookupFailure) {
        throw error;
      }

      logger.warn(
        'MongoDB SRV lookup failed in Node DNS; retrying Atlas connection with DNS-over-HTTPS fallback'
      );

      const fallbackUri = await buildMongoUriFromSrvFallback(env.MONGODB_URI);

      connection = await mongoose.connect(fallbackUri, {
        autoIndex: env.NODE_ENV !== 'production'
      });
    }

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
