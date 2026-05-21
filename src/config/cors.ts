import type { CorsOptions } from 'cors';

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    callback(null, origin ?? true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Accept',
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-Id',
    'X-SafeSpeak-Session'
  ],
  exposedHeaders: ['X-Request-Id'],
  optionsSuccessStatus: 204,
  maxAge: 86400
};
