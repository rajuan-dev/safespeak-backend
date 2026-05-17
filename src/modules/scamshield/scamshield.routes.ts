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
const allowedEvidenceExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.doc', '.docx']);
const allowedEvidenceMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const getFileExtension = (fileName: string): string => {
  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];

  return extension ?? '';
};

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 8
  },
  fileFilter: (_req, file, callback) => {
    const extension = getFileExtension(file.originalname);
    const isAllowed =
      file.mimetype.startsWith('image/') ||
      allowedEvidenceMimeTypes.has(file.mimetype) ||
      allowedEvidenceExtensions.has(extension);

    if (!isAllowed) {
      callback(new Error('Upload an image, screenshot, PDF, or Word document for ScamShield analysis'));
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
  evidenceUpload.any(),
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
