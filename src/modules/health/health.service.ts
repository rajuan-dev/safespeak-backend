import dayjs from 'dayjs';

import { env } from '@config/env';

export interface HealthStatus {
  status: 'ok';
  service: string;
  environment: string;
  timestamp: string;
  uptime: number;
  version: string;
}

export const getHealthStatus = (): HealthStatus => ({
  status: 'ok',
  service: env.APP_NAME,
  environment: env.NODE_ENV,
  timestamp: dayjs().toISOString(),
  uptime: process.uptime(),
  version: env.APP_VERSION
});
