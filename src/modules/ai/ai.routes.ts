import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  clarifyingQuestionsController,
  extractIncidentFieldsController,
  generateSummaryController,
  redactPiiController,
  translateController,
  triageReportController
} from './ai.controller';
import {
  clarifyingQuestionsSchema,
  extractIncidentFieldsSchema,
  generateSummarySchema,
  redactPiiSchema,
  translateSchema,
  triageReportSchema
} from './ai.schema';

export const aiRoutes = Router();

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
