import { Router } from 'express';
import multer from 'multer';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';
import { env } from '@config/env';

import {
  clarifyingQuestionsController,
  extractIncidentFieldsController,
  generateSummaryController,
  redactPiiController,
  synthesizeSpeechController,
  transcribeAudioController,
  translateController,
  triageReportController
} from './ai.controller';
import {
  clarifyingQuestionsSchema,
  extractIncidentFieldsSchema,
  generateSummarySchema,
  redactPiiSchema,
  synthesizeSpeechSchema,
  transcribeAudioBodySchema,
  translateSchema,
  triageReportSchema
} from './ai.schema';

export const aiRoutes = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ASR_MAX_FILE_SIZE_BYTES,
    files: 1
  }
});

aiRoutes.use(authenticateSessionOrUser);

aiRoutes.post(
  '/extract-incident-fields',
  validate({ body: extractIncidentFieldsSchema }),
  extractIncidentFieldsController
);
aiRoutes.post('/triage-report', validate({ body: triageReportSchema }), triageReportController);
aiRoutes.post(
  '/clarifying-questions',
  validate({ body: clarifyingQuestionsSchema }),
  clarifyingQuestionsController
);
aiRoutes.post(
  '/generate-summary',
  validate({ body: generateSummarySchema }),
  generateSummaryController
);
aiRoutes.post('/translate', validate({ body: translateSchema }), translateController);
aiRoutes.post('/redact-pii', validate({ body: redactPiiSchema }), redactPiiController);
aiRoutes.post(
  '/synthesize-speech',
  validate({ body: synthesizeSpeechSchema }),
  synthesizeSpeechController
);
aiRoutes.post(
  '/transcribe-audio',
  upload.single('audio'),
  validate({ body: transcribeAudioBodySchema }),
  transcribeAudioController
);
