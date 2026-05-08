import { Router } from 'express';
import multer from 'multer';

import { validate } from '@common/middleware/validate.middleware';
import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { env } from '@config/env';

import {
  completeUploadController,
  createUploadUrlController,
  deleteEvidenceController,
  getEvidenceAuditChainController,
  getEvidenceController,
  getEvidenceMetadataController,
  verifyHashController
} from './evidence.controller';
import {
  completeUploadBodySchema,
  createUploadUrlSchema,
  evidenceParamsSchema,
  verifyHashBodySchema
} from './evidence.schema';

export const evidenceRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.EVIDENCE_MAX_FILE_SIZE_BYTES,
    files: 1
  }
});

evidenceRoutes.use(authenticateSessionOrUser);
evidenceRoutes.post(
  '/evidence/upload-url',
  validate({ body: createUploadUrlSchema }),
  createUploadUrlController
);
evidenceRoutes.post(
  '/evidence/complete-upload',
  upload.single('file'),
  validate({ body: completeUploadBodySchema }),
  completeUploadController
);
evidenceRoutes.get(
  '/evidence/:id',
  validate({ params: evidenceParamsSchema }),
  getEvidenceController
);
evidenceRoutes.get(
  '/evidence/:id/metadata',
  validate({ params: evidenceParamsSchema }),
  getEvidenceMetadataController
);
evidenceRoutes.get(
  '/evidence/:id/audit-chain',
  validate({ params: evidenceParamsSchema }),
  getEvidenceAuditChainController
);
evidenceRoutes.delete(
  '/evidence/:id',
  validate({ params: evidenceParamsSchema }),
  deleteEvidenceController
);
evidenceRoutes.post(
  '/evidence/:id/verify-hash',
  validate({ params: evidenceParamsSchema, body: verifyHashBodySchema }),
  verifyHashController
);
