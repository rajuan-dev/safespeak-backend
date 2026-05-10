import { Router } from 'express';

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
  listKnowledgeSourcesController,
  rejectKnowledgeSourceController,
  reindexKnowledgeSourceController,
  searchRagController,
  timelineAssistantController,
  updateKnowledgeSourceController
} from './rag.controller';
import {
  createKnowledgeSourceSchema,
  ingestKnowledgeSourceSchema,
  ragAnswerSchema,
  ragParamsSchema,
  ragSearchSchema,
  ragTimelineAssistantSchema,
  rejectKnowledgeSourceSchema,
  updateKnowledgeSourceSchema
} from './rag.schema';

export const ragRoutes = Router();

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
ragRoutes.use('/knowledge-sources', authenticateUser, requireAdminRole());
ragRoutes.get('/knowledge-sources', listKnowledgeSourcesController);
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
ragRoutes.post(
  '/knowledge-sources/:id/ingest',
  validate({ params: ragParamsSchema, body: ingestKnowledgeSourceSchema }),
  ingestKnowledgeSourceController
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
