import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  appendConversationFlowMessageController,
  createConversationFlowSessionController,
  getConversationFlowDetailsController,
  getConversationFlowRecommendationsController,
  getConversationFlowSessionController,
  getConversationFlowTriageController
} from './conversation-flow.controller';
import {
  appendConversationFlowMessageSchema,
  conversationFlowSessionParamsSchema,
  createConversationFlowSessionSchema
} from './conversation-flow.schema';

export const conversationFlowRoutes = Router();

conversationFlowRoutes.use(authenticateSessionOrUser);
conversationFlowRoutes.post(
  '/sessions',
  validate({ body: createConversationFlowSessionSchema }),
  createConversationFlowSessionController
);
conversationFlowRoutes.get(
  '/sessions/:id',
  validate({ params: conversationFlowSessionParamsSchema }),
  getConversationFlowSessionController
);
conversationFlowRoutes.post(
  '/sessions/:id/messages',
  validate({
    params: conversationFlowSessionParamsSchema,
    body: appendConversationFlowMessageSchema
  }),
  appendConversationFlowMessageController
);
conversationFlowRoutes.get(
  '/sessions/:id/triage',
  validate({ params: conversationFlowSessionParamsSchema }),
  getConversationFlowTriageController
);
conversationFlowRoutes.get(
  '/sessions/:id/recommendations',
  validate({ params: conversationFlowSessionParamsSchema }),
  getConversationFlowRecommendationsController
);
conversationFlowRoutes.get(
  '/sessions/:id/details',
  validate({ params: conversationFlowSessionParamsSchema }),
  getConversationFlowDetailsController
);
