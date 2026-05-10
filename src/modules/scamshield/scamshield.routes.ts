import { Router } from 'express';
import multer from 'multer';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  analyzeEmailController,
  analyzeScreenshotController,
  analyzeTextController,
  checkUrlController,
  generateReportDraftByIdController,
  generateReportDraftController,
  getAnalysisController,
  redactController,
  submitByIdController,
  submitController
} from './scamshield.controller';
import {
  analyzeEmailSchema,
  analyzeTextSchema,
  checkUrlSchema,
  generateReportDraftByIdSchema,
  generateReportDraftSchema,
  redactScamContentSchema,
  scamShieldParamsSchema,
  submitScamReportByIdSchema,
  submitScamReportSchema
} from './scamshield.schema';

export const scamShieldRoutes = Router();
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('Only image files are supported for screenshot analysis'));
      return;
    }

    callback(null, true);
  }
});

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
  screenshotUpload.single('image'),
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
scamShieldRoutes.post(
  '/:id/generate-report-draft',
  validate({ params: scamShieldParamsSchema, body: generateReportDraftByIdSchema }),
  generateReportDraftByIdController
);
scamShieldRoutes.post(
  '/:id/submit',
  validate({ params: scamShieldParamsSchema, body: submitScamReportByIdSchema }),
  submitByIdController
);
scamShieldRoutes.get('/:id', validate({ params: scamShieldParamsSchema }), getAnalysisController);
