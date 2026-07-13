import { Router } from 'express';

import {
  authenticateSessionOrUser,
  authenticateUser,
  requireAdminRole
} from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  answerRagController,
  debugRetrieveRagController,
  searchRagController,
  timelineAssistantController
} from './rag.controller';
import {
  ragAnswerSchema,
  ragDebugRetrieveSchema,
  ragSearchSchema,
  ragTimelineAssistantSchema
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
ragRoutes.post('/debug/retrieve', authenticateUser, requireAdminRole('super_admin', 'content_admin'), validate({ body: ragDebugRetrieveSchema }), debugRetrieveRagController);
