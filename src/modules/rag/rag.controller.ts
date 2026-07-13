import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';
import {
  callAiAgentRagAnswer,
  callAiAgentRagSearch,
  callAiAgentTimelineAssistant
} from '@modules/ai/ai-agent.client';
import { canAccessAdmin } from '@modules/rbac/rbac.utils';

import { assertRagAiConsent } from './rag.consent';
import {
  approveKnowledgeSource,
  approveOcrKnowledgeSource,
  createKnowledgeSource,
  deleteKnowledgeSource,
  debugRetrieveRag,
  getPineconeHealth,
  getKnowledgeSourceOcrPreview,
  getKnowledgeSourceStatus,
  ingestKnowledgeSource,
  getKnowledgeSourceReadiness,
  listKnowledgeSourceChunks,
  listKnowledgeSources,
  rejectKnowledgeSource,
  reindexKnowledgeSource,
  refreshKnowledgeSource,
  runKnowledgeSourceOcr,
  uploadKnowledgeSourceDocument,
  updateKnowledgeSource
} from './rag.service';
import type { RagServiceContext } from './rag.types';
import type {
  CreateKnowledgeSourceInput,
  ApproveOcrKnowledgeSourceInput,
  KnowledgeSourceOcrPreviewQueryInput,
  KnowledgeSourceChunkQueryInput,
  IngestKnowledgeSourceInput,
  RagAnswerInput,
  RagDebugRetrieveInput,
  RagSearchInput,
  RagTimelineAssistantInput,
  RefreshKnowledgeSourceInput,
  RejectKnowledgeSourceInput,
  RunOcrKnowledgeSourceInput,
  UpdateKnowledgeSourceInput
} from './rag.schema';

const getContext = (req: Request): RagServiceContext => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  actorType: req.user && canAccessAdmin(req.user.role) ? 'admin' : undefined,
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const searchRagController = asyncHandler(async (req: Request, res: Response) => {
  await assertRagAiConsent(getContext(req).owner);
  const data = await callAiAgentRagSearch<{ results: unknown[] }>(req.body as RagSearchInput);

  res.status(StatusCodes.OK).json(
    successResponse(
      'RAG search completed',
      data,
      {
        informationOnly: true,
        citationsRequired: true
      }
    )
  );
});

export const answerRagController = asyncHandler(async (req: Request, res: Response) => {
  await assertRagAiConsent(getContext(req).owner);
  const result = await callAiAgentRagAnswer<Record<string, unknown>>(req.body as RagAnswerInput);

  res.status(StatusCodes.OK).json(successResponse('RAG answer generated', result, { informationOnly: true }));
});

export const timelineAssistantController = asyncHandler(async (req: Request, res: Response) => {
  await assertRagAiConsent(getContext(req).owner);
  const result = await callAiAgentTimelineAssistant<Record<string, unknown>>(
    req.body as RagTimelineAssistantInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Timeline assistant response generated', result, { informationOnly: true }));
});

export const listKnowledgeSourcesController = asyncHandler(async (_req: Request, res: Response) => {
  const sources = await listKnowledgeSources();

  res.status(StatusCodes.OK).json(successResponse('Knowledge sources retrieved', { sources }));
});

export const knowledgeSourceReadinessController = asyncHandler(
  async (req: Request, res: Response) => {
    const readiness = await getKnowledgeSourceReadiness(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source readiness retrieved', { readiness }));
  }
);

export const pineconeHealthController = asyncHandler(async (req: Request, res: Response) => {
  const health = await getPineconeHealth(getContext(req));

  res.status(StatusCodes.OK).json(successResponse('Pinecone health retrieved', { health }));
});

export const debugRetrieveRagController = asyncHandler(async (req: Request, res: Response) => {
  const result = await debugRetrieveRag(getContext(req), req.body as RagDebugRetrieveInput);

  res
    .status(StatusCodes.OK)
    .json(successResponse('RAG debug retrieval completed', result, { informationOnly: true }));
});

export const listKnowledgeSourceChunksController = asyncHandler(
  async (req: Request, res: Response) => {
    const chunkPage = await listKnowledgeSourceChunks(
      getContext(req),
      req.params.id,
      req.query as unknown as KnowledgeSourceChunkQueryInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source chunks retrieved', chunkPage));
  }
);

export const createKnowledgeSourceController = asyncHandler(async (req: Request, res: Response) => {
  const source = await createKnowledgeSource(
    getContext(req),
    req.body as CreateKnowledgeSourceInput
  );

  res.status(StatusCodes.CREATED).json(successResponse('Knowledge source created', { source }));
});

export const updateKnowledgeSourceController = asyncHandler(async (req: Request, res: Response) => {
  const source = await updateKnowledgeSource(
    getContext(req),
    req.params.id,
    req.body as UpdateKnowledgeSourceInput
  );

  res.status(StatusCodes.OK).json(successResponse('Knowledge source updated', { source }));
});

export const deleteKnowledgeSourceController = asyncHandler(async (req: Request, res: Response) => {
  await deleteKnowledgeSource(getContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Knowledge source deleted', null));
});

export const uploadKnowledgeSourceDocumentController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body as { ingestImmediately?: unknown };
    const result = await uploadKnowledgeSourceDocument(
      getContext(req),
      req.params.id,
      req.file,
      {
        ingestImmediately: body.ingestImmediately !== 'false'
      }
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source document uploaded', { result }, { informationOnly: true }));
  }
);

export const ingestKnowledgeSourceController = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestKnowledgeSource(
    getContext(req),
    req.params.id,
    req.body as IngestKnowledgeSourceInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Knowledge source ingested', { result }, { informationOnly: true }));
});

export const refreshKnowledgeSourceController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await refreshKnowledgeSource(
      getContext(req),
      req.params.id,
      req.body as RefreshKnowledgeSourceInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source refreshed', { result }, { informationOnly: true }));
  }
);

export const approveKnowledgeSourceController = asyncHandler(
  async (req: Request, res: Response) => {
    const source = await approveKnowledgeSource(getContext(req), req.params.id);

    res.status(StatusCodes.OK).json(successResponse('Knowledge source approved', { source }));
  }
);

export const runKnowledgeSourceOcrController = asyncHandler(async (req: Request, res: Response) => {
  const result = await runKnowledgeSourceOcr(
    getContext(req),
    req.params.id,
    req.body as RunOcrKnowledgeSourceInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Knowledge source OCR completed', { result }, { informationOnly: true }));
});

export const approveOcrKnowledgeSourceController = asyncHandler(
  async (req: Request, res: Response) => {
    const source = await approveOcrKnowledgeSource(
      getContext(req),
      req.params.id,
      req.body as ApproveOcrKnowledgeSourceInput
    );

    res.status(StatusCodes.OK).json(successResponse('Knowledge source OCR approved', { source }));
  }
);

export const getKnowledgeSourceOcrPreviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const preview = await getKnowledgeSourceOcrPreview(
      getContext(req),
      req.params.id,
      req.query as unknown as KnowledgeSourceOcrPreviewQueryInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source OCR preview retrieved', { preview }));
  }
);

export const getKnowledgeSourceStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const status = await getKnowledgeSourceStatus(getContext(req), req.params.id);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source status retrieved', { status }));
  }
);

export const rejectKnowledgeSourceController = asyncHandler(async (req: Request, res: Response) => {
  const source = await rejectKnowledgeSource(
    getContext(req),
    req.params.id,
    req.body as RejectKnowledgeSourceInput
  );

  res.status(StatusCodes.OK).json(successResponse('Knowledge source rejected', { source }));
});

export const reindexKnowledgeSourceController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await reindexKnowledgeSource(getContext(req), req.params.id);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Knowledge source reindexed', { result }, { informationOnly: true }));
  }
);
