import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  analyzeEmailController,
  analyzeScreenshotController,
  analyzeTextController,
  checkUrlController,
  generateReportDraftController,
  getAnalysisController,
  redactController,
  submitController
} from './scamshield.controller';
import {
  analyzeEmailSchema,
  analyzeScreenshotSchema,
  analyzeTextSchema,
  checkUrlSchema,
  generateReportDraftSchema,
  redactScamContentSchema,
  scamShieldParamsSchema,
  submitScamReportSchema
} from './scamshield.schema';

export const scamShieldRoutes = Router();

scamShieldRoutes.use(authenticateSessionOrUser);

scamShieldRoutes.post(
  '/analyze-text',
  validate({ body: analyzeTextSchema }),
  analyzeTextController
);
scamShieldRoutes.post(
  '/analyze-email',
  validate({ body: analyzeEmailSchema }),
  analyzeEmailController
);
scamShieldRoutes.post(
  '/analyze-screenshot',
  validate({ body: analyzeScreenshotSchema }),
  analyzeScreenshotController
);
scamShieldRoutes.post('/check-url', validate({ body: checkUrlSchema }), checkUrlController);
scamShieldRoutes.post('/redact', validate({ body: redactScamContentSchema }), redactController);
scamShieldRoutes.post(
  '/generate-report-draft',
  validate({ body: generateReportDraftSchema }),
  generateReportDraftController
);
scamShieldRoutes.post('/submit', validate({ body: submitScamReportSchema }), submitController);
scamShieldRoutes.get('/:id', validate({ params: scamShieldParamsSchema }), getAnalysisController);
