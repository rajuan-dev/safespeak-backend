import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import type {
  AppendConversationFlowMessageInput,
  CreateConversationFlowSessionInput
} from './conversation-flow.schema';
import {
  appendConversationFlowMessage,
  createConversationFlowSession,
  getConversationFlowDetails,
  getConversationFlowRecommendations,
  getConversationFlowSession,
  getConversationFlowSupport,
  getConversationFlowTriage
} from './conversation-flow.service';

const getContext = (req: Request) => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const createConversationFlowSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await createConversationFlowSession(
      getContext(req),
      req.body as CreateConversationFlowSessionInput
    );

    ApiResponse.created(res, 'Conversation session created', result);
  }
);

export const getConversationFlowSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getConversationFlowSession(getContext(req), req.params.id);

    ApiResponse.success(res, 'Conversation session retrieved', result);
  }
);

export const appendConversationFlowMessageController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await appendConversationFlowMessage(
      getContext(req),
      req.params.id,
      req.body as AppendConversationFlowMessageInput
    );

    ApiResponse.success(res, 'Conversation turn recorded', result);
  }
);

export const getConversationFlowTriageController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getConversationFlowTriage(getContext(req), req.params.id);

    ApiResponse.success(res, 'Conversation triage retrieved', result);
  }
);

export const getConversationFlowSupportController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getConversationFlowSupport(getContext(req), req.params.id);

    ApiResponse.success(res, 'Conversation support bundle retrieved', result);
  }
);

export const getConversationFlowRecommendationsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getConversationFlowRecommendations(getContext(req), req.params.id);

    ApiResponse.success(res, 'Conversation recommendations retrieved', result);
  }
);

export const getConversationFlowDetailsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getConversationFlowDetails(getContext(req), req.params.id);

    ApiResponse.success(res, 'Conversation details retrieved', result);
  }
);
