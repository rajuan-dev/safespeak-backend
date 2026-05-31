import { Router } from 'express';
import multer from 'multer';

import {
  authenticateSessionOrUser,
  authenticateUser,
  requireAdminRole
} from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  answerRagController,
  approveKnowledgeSourceController,
  createKnowledgeSourceController,
  deleteKnowledgeSourceController,
  ingestKnowledgeSourceController,
  knowledgeSourceReadinessController,
  listKnowledgeSourceChunksController,
  listKnowledgeSourcesController,
  pineconeHealthController,
  rejectKnowledgeSourceController,
  reindexKnowledgeSourceController,
  refreshKnowledgeSourceController,
  searchRagController,
  timelineAssistantController,
  uploadKnowledgeSourceDocumentController,
  updateKnowledgeSourceController
} from './rag.controller';
import {
  createKnowledgeSourceSchema,
  knowledgeSourceChunkQuerySchema,
  ingestKnowledgeSourceSchema,
  ragAnswerSchema,
  ragParamsSchema,
  ragSearchSchema,
  ragTimelineAssistantSchema,
  rejectKnowledgeSourceSchema,
  refreshKnowledgeSourceSchema,
  updateKnowledgeSourceSchema
} from './rag.schema';

export const ragRoutes = Router();

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 52428800,
    files: 1
  }
});

ragRoutes.post(
  '/search',
  authenticateSessionOrUser,
  validate({ body: ragSearchSchema }),
  searchRagController
);
ragRoutes.post(
  '/answer',
  authenticateSessionOrUser,
  validate({ body: ragAnswerSchema }),
  answerRagController
);
ragRoutes.post(
  '/timeline-assistant',
  authenticateSessionOrUser,
  validate({ body: ragTimelineAssistantSchema }),
  timelineAssistantController
);
ragRoutes.use('/admin', authenticateUser, requireAdminRole('super_admin', 'content_admin'));
ragRoutes.get('/admin/pinecone/health', pineconeHealthController);
ragRoutes.use('/knowledge-sources', authenticateUser, requireAdminRole('super_admin', 'content_admin'));
ragRoutes.get('/knowledge-sources', listKnowledgeSourcesController);
ragRoutes.get('/knowledge-sources/readiness', knowledgeSourceReadinessController);
ragRoutes.post(
  '/knowledge-sources',
  validate({ body: createKnowledgeSourceSchema }),
  createKnowledgeSourceController
);
ragRoutes.patch(
  '/knowledge-sources/:id',
  validate({ params: ragParamsSchema, body: updateKnowledgeSourceSchema }),
  updateKnowledgeSourceController
);
ragRoutes.delete(
  '/knowledge-sources/:id',
  validate({ params: ragParamsSchema }),
  deleteKnowledgeSourceController
);
ragRoutes.get(
  '/knowledge-sources/:id/chunks',
  validate({ params: ragParamsSchema, query: knowledgeSourceChunkQuerySchema }),
  listKnowledgeSourceChunksController
);
ragRoutes.post(
  '/knowledge-sources/:id/document',
  documentUpload.single('file'),
  validate({ params: ragParamsSchema }),
  uploadKnowledgeSourceDocumentController
);
ragRoutes.post(
  '/knowledge-sources/:id/ingest',
  validate({ params: ragParamsSchema, body: ingestKnowledgeSourceSchema }),
  ingestKnowledgeSourceController
);
ragRoutes.post(
  '/knowledge-sources/:id/refresh',
  validate({ params: ragParamsSchema, body: refreshKnowledgeSourceSchema }),
  refreshKnowledgeSourceController
);
ragRoutes.post(
  '/knowledge-sources/:id/approve',
  validate({ params: ragParamsSchema }),
  approveKnowledgeSourceController
);
ragRoutes.post(
  '/knowledge-sources/:id/reject',
  validate({ params: ragParamsSchema, body: rejectKnowledgeSourceSchema }),
  rejectKnowledgeSourceController
);
ragRoutes.post(
  '/knowledge-sources/:id/reindex',
  validate({ params: ragParamsSchema }),
  reindexKnowledgeSourceController
);
