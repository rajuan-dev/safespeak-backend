import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { StatusCodes } from 'http-status-codes';
import type { FilterQuery, HydratedDocument, PipelineStage } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import {
  buildInformationOnlyDisclaimer,
  detectCrisisRisk,
  detectLegalAdviceRisk,
  detectPoliceReportingRequest,
  detectSafeSpeakProductQuestion,
  detectTrainingDataRequest,
  enforceAiOutputGuardrails,
  shouldRequireHumanReview
} from '@modules/ai/ai-guardrails';
import {
  answerWithContext,
  createEmbedding,
  generateTimelineAssistantTurn
} from '@modules/ai/ai.service';
import type { AiCitation } from '@modules/ai/ai.types';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import {
  DEFAULT_RAG_TOP_K,
  RAG_ACTIONS,
  RAG_CHUNK_OVERLAP,
  RAG_CHUNK_SIZE
} from './rag.constants';
import {
  RagChunkModel,
  RagKnowledgeSourceModel,
  type RagKnowledgeSourceDocument
} from './rag.model';
import type {
  CreateKnowledgeSourceInput,
  IngestKnowledgeSourceInput,
  RagAnswerInput,
  RagSearchInput,
  RagTimelineAssistantInput,
  RejectKnowledgeSourceInput,
  UpdateKnowledgeSourceInput
} from './rag.schema';
import type { RagOwner, RagSearchResult, RagServiceContext, RagSourceCategory } from './rag.types';

const ownerFilter = (owner: RagOwner): RagOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');

const assertAiConsent = async (owner: RagOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'process_with_ai consent is required for AI processing');
  }
};

const auditRagAction = async (
  context: RagServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.actorType ?? (context.owner.userId ? 'user' : 'anonymous_session'),
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

type HydratedRagKnowledgeSourceDocument = HydratedDocument<RagKnowledgeSourceDocument>;

const getSource = async (sourceId: string): Promise<HydratedRagKnowledgeSourceDocument> => {
  const source = await RagKnowledgeSourceModel.findOne({ _id: sourceId, deletedAt: { $exists: false } });

  if (!source) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Knowledge source not found');
  }

  return source;
};

const chunkText = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    chunks.push(normalized.slice(cursor, cursor + RAG_CHUNK_SIZE));
    cursor += RAG_CHUNK_SIZE - RAG_CHUNK_OVERLAP;
  }

  return chunks;
};

const readIngestionText = async (input: IngestKnowledgeSourceInput): Promise<string> => {
  if (input.content) {
    return input.content;
  }

  if (!input.localFilePath) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'content or localFilePath is required');
  }

  return readFile(input.localFilePath, 'utf8');
};

const uniqueMatches = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const extractLegalMetadataFromText = (
  text: string,
  source: Pick<RagKnowledgeSourceDocument, 'title' | 'jurisdiction' | 'sourceType' | 'sourceCategory'>
): Record<string, unknown> => {
  const actNameMatches = Array.from(
    text.matchAll(/\b([A-Z][A-Za-z'’().,&/-]+(?:\s+[A-Z][A-Za-z'’().,&/-]+){0,8}\s+(?:Act|Regulation|Code|Charter|Constitution|Policy))\b/g)
  ).map((match) => match[1]?.trim() ?? '');
  const sectionMatches = Array.from(
    text.matchAll(/\b(?:s|sec|section|sections|pt|part|cl|clause|art|article)\.?\s*([0-9A-Za-z().,-]+)/gi)
  ).map((match) => match[0]?.trim() ?? '');
  const constitutionalMentions = Array.from(
    text.matchAll(/\b(constitution|constitutional|human rights|bill of rights|implied freedom)\b/gi)
  ).map((match) => match[1]?.trim() ?? '');
  const courtMatches = Array.from(
    text.matchAll(/\b(High Court|Federal Court|Supreme Court|Local Court|District Court|Tribunal)\b/gi)
  ).map((match) => match[1]?.trim() ?? '');

  const legislationType =
    /\bconstitution(?:al)?\b/i.test(text) || /\bconstitution\b/i.test(source.title)
      ? 'constitution'
      : /\bregulation\b/i.test(text) || /\bregulation\b/i.test(source.title)
        ? 'regulation'
        : /\bpolicy\b/i.test(text) || /\bpolicy\b/i.test(source.title)
          ? 'policy'
          : /\bact\b/i.test(text) || /\bact\b/i.test(source.title)
            ? 'act'
            : source.sourceType.toLowerCase();

  return {
    detectedLegalType: legislationType,
    detectedActNames: uniqueMatches(actNameMatches).slice(0, 20),
    detectedSectionRefs: uniqueMatches(sectionMatches).slice(0, 40),
    detectedConstitutionalMentions: uniqueMatches(
      constitutionalMentions.map((item) => item.toLowerCase())
    ).slice(0, 20),
    detectedCourts: uniqueMatches(courtMatches).slice(0, 20),
    detectedJurisdictionHint: source.jurisdiction
  };
};

export const listKnowledgeSources = async (): Promise<unknown[]> =>
  RagKnowledgeSourceModel.find({ deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();

export const createKnowledgeSource = async (
  context: RagServiceContext,
  input: CreateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);

  if (input.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Knowledge sources must be approved through the review workflow'
    );
  }

  const source = await RagKnowledgeSourceModel.create({ ...input, createdBy: context.owner.userId });

  await auditRagAction(context, RAG_ACTIONS.sourceCreate, source._id.toString(), {
    sourceType: source.sourceType,
    sourceCategory: source.sourceCategory
  });

  return source;
};

export const updateKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: UpdateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);

  if (input.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Use the approval endpoint to approve a knowledge source'
    );
  }

  const source = await getSource(sourceId);
  source.set(input);
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceUpdate, source._id.toString(), {
    changedFields: Object.keys(input)
  });

  return source;
};

export const deleteKnowledgeSource = async (context: RagServiceContext, sourceId: string): Promise<void> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.status = 'expired';
  source.deletedAt = new Date();
  await source.save();
  await RagChunkModel.deleteMany({ sourceId: source._id });

  await auditRagAction(context, RAG_ACTIONS.sourceDelete, source._id.toString());
};

export const ingestKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: IngestKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.ingestionStatus = 'fetched';
  source.ingestionError = undefined;
  await source.save();

  try {
    const text = await readIngestionText(input);
    const sha256Hash = hashText(text);

    if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256Hash) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Knowledge source SHA-256 verification failed');
    }

    const chunks = chunkText(text);
    await RagChunkModel.deleteMany({ sourceId: source._id });
    source.ingestionStatus = 'chunked';
    await source.save();

    const extractedLegalMetadata = extractLegalMetadataFromText(text, source);
    const embeddedChunks = await Promise.all(
      chunks.map(async (chunk, index) => ({
        sourceId: source._id,
        sourceCategory: source.sourceCategory,
        jurisdiction: source.jurisdiction,
        topic: source.topic,
        sectionRef: undefined,
        chunkIndex: index,
        chunkText: chunk,
        embedding: await createEmbedding(chunk),
        tokenCount: Math.ceil(chunk.length / 4),
        citationLabel: `${source.title} [chunk ${index + 1}]`,
        citationUrl: source.url,
        metadata: {
          ...input.metadata,
          ...extractedLegalMetadata,
          sourceTitle: source.title,
          sourceType: source.sourceType,
          sourceCategory: source.sourceCategory,
          language: source.language,
          jurisdiction: source.jurisdiction
        }
      }))
    );

    if (embeddedChunks.length > 0) {
      await RagChunkModel.insertMany(embeddedChunks);
    }

    source.sha256Hash = sha256Hash;
    source.rawText = text;
    source.status = source.sourceCategory === 'internal_product_rule' ? source.status : 'pending_review';
    source.ingestedAt = new Date();
    source.ingestionStatus = 'embedded';
    source.version = (source.version ?? 1) + 1;
    source.metadata = {
      ...source.metadata,
      ...input.metadata,
      ...extractedLegalMetadata,
      chunkCount: embeddedChunks.length,
      sha256Verified: true
    };
    await source.save();

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      chunkCount: embeddedChunks.length,
      sha256Hash,
      requiresHumanReview: source.status !== 'approved'
    });

    return {
      source,
      chunkCount: embeddedChunks.length,
      sha256Hash,
      extractedLegalMetadata,
      reviewStatus: 'pending_human_review'
    };
  } catch (error) {
    source.ingestionStatus = 'failed';
    source.ingestionError = error instanceof Error ? error.message : 'Knowledge source ingestion failed';
    await source.save();
    throw error;
  }
};

export const approveKnowledgeSource = async (context: RagServiceContext, sourceId: string): Promise<unknown> => {
  const owner = ownerFilter(context.owner);
  const source = await getSource(sourceId);

  if (source.createdBy && owner.userId && source.createdBy.toString() === owner.userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Knowledge sources must be approved by a different admin'
    );
  }

  source.status = 'approved';
  source.approvedBy = context.owner.userId as never;
  source.approvedAt = new Date();
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceApprove, source._id.toString());

  return source;
};

export const rejectKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: RejectKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  source.status = 'rejected';
  source.rejectedBy = context.owner.userId as never;
  source.rejectedAt = new Date();
  source.rejectionReason = input.reason;
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceReject, source._id.toString(), { reason: input.reason });

  return source;
};

export const reindexKnowledgeSource = async (context: RagServiceContext, sourceId: string): Promise<unknown> => {
  const source = await getSource(sourceId);

  if (!source.rawText) {
    throw new ApiError(StatusCodes.CONFLICT, 'Knowledge source has no ingested text to reindex');
  }

  const result = await ingestKnowledgeSource(context, sourceId, {
    content: source.rawText,
    expectedSha256: source.sha256Hash,
    metadata: source.metadata
  });

  await auditRagAction(context, RAG_ACTIONS.sourceReindex, source._id.toString());

  return result;
};

const classifySourceCategory = (input: RagAnswerInput | RagSearchInput): RagSourceCategory => {
  if (input.sourceCategory) {
    return input.sourceCategory;
  }

  const q = ('question' in input ? input.question : input.query).toLowerCase();
  if (/(law|legal|legislation|act|rights|court|discrimination|racial abuse|racial hatred|vilification|harassment|employer|what are my options)/i.test(q)) {
    return 'official_legal_source';
  }
  if (/(support|helpline|000|1800respect|lifeline|reportcyber|scamwatch)/i.test(q)) return 'official_support_source';
  return 'internal_product_rule';
};

const buildSourceFilter = (
  input: RagSearchInput,
  category: RagSourceCategory
): FilterQuery<RagKnowledgeSourceDocument> => ({
  status: 'approved',
  deletedAt: { $exists: false },
  sourceCategory: category,
  ...(category === 'official_legal_source' ? { legalReviewed: true } : {}),
  ...(input.language ? { language: input.language } : {}),
  ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
  ...(input.topic ? { topic: input.topic } : {})
});

const isVectorSearchUnavailable = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return /SearchNotEnabled|vectorSearch|search index|index .*not found/i.test(message);
};

const buildFallbackAnswer = (
  question: string,
  category: RagSourceCategory,
  flags: { crisisRisk: boolean; legalAdviceRisk: boolean; insufficientSources: boolean },
  fallbackReason: 'insufficient_sources' | 'vector_unavailable'
): Record<string, unknown> => {
  const disclaimer = buildInformationOnlyDisclaimer();
  const reasonText =
    fallbackReason === 'vector_unavailable'
      ? 'SafeSpeak knowledge retrieval is not fully configured yet.'
      : 'SafeSpeak does not have enough approved authoritative information to answer this confidently right now.';
  const lowerQuestion = question.toLowerCase();
  const reportingRequest = detectPoliceReportingRequest(lowerQuestion);
  const trainingDataRequest = detectTrainingDataRequest(lowerQuestion);
  const safeSpeakProductQuestion = detectSafeSpeakProductQuestion(lowerQuestion);

  if (flags.crisisRisk) {
    return {
      answer: [
        'If you are in immediate danger, call 000 now.',
        'If it is safe, contact 1800RESPECT.',
        'SafeSpeak is not a crisis service and cannot provide emergency response.',
        'SafeSpeak can only offer general information and triage support.'
      ].join(' '),
      disclaimer,
      citations: [],
      sourceCategoriesUsed: [],
      confidence: 'low',
      pendingHumanReview: true,
      safetyFlags: flags
    };
  }

  if (reportingRequest) {
    return {
      answer: [
        'SafeSpeak does not automatically report to police or agencies for you.',
        'Any sharing or submission requires your explicit consent.',
        'If you want to contact police or another service, SafeSpeak can help explain general options only.'
      ].join(' '),
      disclaimer,
      citations: [],
      sourceCategoriesUsed: [],
      confidence: 'low',
      pendingHumanReview: true,
      safetyFlags: flags
    };
  }

  if (trainingDataRequest) {
    return {
      answer: [
        'SafeSpeak does not use user reports, chats, or evidence as RAG training or knowledge-source data.',
        'Private user content is not ingested into the SafeSpeak knowledge base.'
      ].join(' '),
      disclaimer,
      citations: [],
      sourceCategoriesUsed: [],
      confidence: 'low',
      pendingHumanReview: true,
      safetyFlags: flags
    };
  }

  if (safeSpeakProductQuestion || category === 'internal_product_rule') {
    return {
      answer: [
        'SafeSpeak is an information and triage tool for racism, online abuse, scams, and related harms.',
        'It is not legal advice, counselling, a crisis service, case management, or automatic reporting.',
        'It can help explain options, support safer reporting choices, and route people toward relevant services when they choose to share information.',
        reasonText
      ].join(' '),
      disclaimer,
      citations: [],
      sourceCategoriesUsed: [],
      confidence: 'low',
      pendingHumanReview: true,
      safetyFlags: flags
    };
  }

  if (category === 'official_legal_source') {
    return {
      answer: [
        'SafeSpeak does not have enough approved authoritative legal sources to answer this confidently right now.',
        'General options may include documenting what happened, considering support services, and seeking information from an official agency or qualified legal support if safe and appropriate.'
      ].join(' '),
      disclaimer,
      citations: [],
      sourceCategoriesUsed: [],
      confidence: 'low',
      pendingHumanReview: true,
      safetyFlags: flags
    };
  }

  return {
    answer: reasonText,
    disclaimer,
    citations: [],
    sourceCategoriesUsed: [],
    confidence: 'low',
    pendingHumanReview: true,
    safetyFlags: flags
  };
};

export const searchRag = async (context: RagServiceContext, input: RagSearchInput): Promise<RagSearchResult[]> => {
  await assertAiConsent(context.owner);
  const queryVector = await createEmbedding(input.query);
  const sourceCategory = classifySourceCategory(input);
  const sourceFilter = buildSourceFilter(input, sourceCategory);
  const sourceIds = await RagKnowledgeSourceModel.find(sourceFilter).sort({ lastUpdated: -1 }).distinct('_id');

  if (sourceIds.length === 0) {
    return [];
  }

  const pipeline: PipelineStage[] = [
    {
      $vectorSearch: {
        index: env.RAG_VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max((input.topK ?? DEFAULT_RAG_TOP_K) * 10, 50),
        limit: input.topK ?? DEFAULT_RAG_TOP_K,
        filter: { sourceId: { $in: sourceIds }, sourceCategory }
      }
    },
    { $lookup: { from: 'ragknowledgesources', localField: 'sourceId', foreignField: '_id', as: 'source' } },
    { $unwind: '$source' },
    {
      $project: {
        _id: 1,
        sourceId: 1,
        chunkText: 1,
        sectionRef: 1,
        citationUrl: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' },
        'source.title': 1,
        'source.publisher': 1,
        'source.sourceCategory': 1,
        'source.sourceType': 1,
        'source.topic': 1,
        'source.jurisdiction': 1,
        'source.lastUpdated': 1
      }
    }
  ];

  type RagAggregateResult = {
    _id: { toString(): string };
    sourceId: { toString(): string };
    chunkText: string;
    sectionRef?: string;
    citationUrl?: string;
    metadata?: Record<string, unknown>;
    score?: number;
    source: {
      title: string;
      publisher: string;
      sourceCategory: RagSourceCategory;
      sourceType: RagSearchResult['sourceType'];
      topic: RagSearchResult['topic'];
      jurisdiction: RagSearchResult['jurisdiction'];
      lastUpdated?: Date;
    };
  };
  const results = await RagChunkModel.aggregate<RagAggregateResult>(pipeline);
  await auditRagAction(context, RAG_ACTIONS.search, undefined, { resultCount: results.length, topK: input.topK ?? DEFAULT_RAG_TOP_K });

  return results.map((result) => ({
    chunkId: result._id.toString(),
    sourceId: result.sourceId.toString(),
    title: result.source.title,
    publisher: result.source.publisher,
    sourceCategory: result.source.sourceCategory,
    sourceType: result.source.sourceType,
    jurisdiction: result.source.jurisdiction,
    topic: result.source.topic,
    sectionRef: result.sectionRef,
    citationUrl: result.citationUrl,
    lastUpdated: result.source.lastUpdated,
    text: result.chunkText,
    score: result.score,
    metadata: result.metadata ?? {}
  }));
};

export const answerRag = async (context: RagServiceContext, input: RagAnswerInput): Promise<Record<string, unknown>> => {
  const category = classifySourceCategory(input);
  let results: RagSearchResult[] = [];
  let fallbackReason: 'insufficient_sources' | 'vector_unavailable' = 'insufficient_sources';

  try {
    results = await searchRag(context, { ...input, query: input.question, sourceCategory: category });
  } catch (error) {
    if (!isVectorSearchUnavailable(error)) {
      throw error;
    }

    fallbackReason = 'vector_unavailable';
  }

  const insufficientSources = results.length === 0;
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));

  const safetySeedText = `${input.question}\n${results.map((r) => r.text).join('\n')}`;
  const legalAdviceRisk = detectLegalAdviceRisk(safetySeedText);
  const crisisRisk = detectCrisisRisk(safetySeedText);
  const pendingHumanReview = shouldRequireHumanReview({ legalAdviceRisk, crisisRisk, insufficientSources });

  if (insufficientSources) {
    return buildFallbackAnswer(
      input.question,
      category,
      { crisisRisk, legalAdviceRisk, insufficientSources },
      fallbackReason
    );
  }

  const contextText = results.map((result, index) => `[${index + 1}] ${result.title}: ${result.text}`).join('\n\n');

  const modelResponse = await answerWithContext(context, {
    question: input.question,
    language: input.language,
    citations,
    contextText
  });

  const output = (modelResponse.output ?? {}) as Record<string, unknown>;
  const answerCandidate = output.answer ?? output.text;
  const answerText = enforceAiOutputGuardrails(
    typeof answerCandidate === 'string' ? answerCandidate : JSON.stringify(answerCandidate ?? '')
  );

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, { citationCount: results.length, sourceCategory: category });

  return {
    answer: answerText,
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: results.map((result) => ({
      title: result.title,
      publisher: result.publisher,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      sectionRef: result.sectionRef,
      lastUpdated: result.lastUpdated
    })),
    sourceCategoriesUsed: Array.from(new Set(results.map((result) => result.sourceCategory))),
    confidence: results.length >= 4 ? 'high' : results.length >= 2 ? 'medium' : 'low',
    pendingHumanReview,
    safetyFlags: { crisisRisk, legalAdviceRisk, insufficientSources }
  };
};

const normalizeTimelineValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeTimelineKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

const normalizeTimelineObject = (
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, string> => {
  const normalized: Record<string, string> = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = normalizeTimelineKey(rawKey);
      const value = normalizeTimelineValue(rawValue);

      if (!key || !value) {
        continue;
      }

      normalized[key] = value;
    }
  }

  return normalized;
};

const TIMELINE_VALUE_WORD_LIMITS: Partial<Record<string, number>> = {
  who: 8,
  relationship: 6,
  what: 12,
  where: 8,
  when: 8,
  how: 10,
  frequency: 8,
  impact: 10,
  threats: 10,
  injuries: 10,
  witnesses: 10,
  evidence: 10,
  actions_taken: 10,
  unsafe_now: 6
};

const TIMELINE_FILLER_PREFIX = new RegExp(
  [
    '^\\s*',
    '(?:hey|hi|hello|okay|ok|so|well|um|uh|like|just|please|basically|actually)',
    '[,\\s]+'
  ].join(''),
  'i'
);

const HARM_ACTION_PATTERNS = [
  /\b(?:someone|somebody|a man|a woman|they|he|she|my\s+\w+|the\s+\w+)\s+(?:pulled|grabbed|pushed|hit|slapped|kicked|touched|followed|harassed|abused|threatened|yelled at|shouted at|insulted|spat at|stole|took|snatched)\b[^.?!,;]*/i,
  /\b(?:pulled|grabbed|pushed|hit|slapped|kicked|touched|followed|harassed|abused|threatened|insulted|stole|took|snatched)\b[^.?!,;]*/i
];

const ACTIVITY_CONTEXT_PATTERNS = [
  /\b(?:while|when)\s+i\s+(?:was|am|'m)\s+(?:just\s+)?(?:walking|working|going|standing|waiting|travelling|traveling)\b[^.?!,;]*/i,
  /\bi\s+(?:was|am|'m)\s+(?:just\s+)?(?:walking|working|going|standing|waiting|travelling|traveling)\b[^.?!,;]*/i
];

const WHERE_PATTERNS = [
  /\b(?:on|in|at|near|outside|inside)\s+(?:the\s+)?(?:street|road|bus stop|train station|school|campus|office|workplace|shop|store|market|park|home|house|mosque|mall)\b[^.?!,;]*/i,
  /\b(?:at home|at work|at school|on the street|in the street)\b/i
];

const WHEN_PATTERNS = [
  /\b(?:today|yesterday|last night|last week|this morning|this afternoon|this evening|tonight)\b(?:\s+around\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i,
  /\b(?:around|about)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i
];

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const trimTimelineValueWords = (value: string, limit: number): string => {
  const words = collapseWhitespace(value).split(' ');

  if (words.length <= limit) {
    return value.trim();
  }

  return words.slice(0, limit).join(' ').trim();
};

const stripLeadingFiller = (value: string): string => {
  let nextValue = value.trim();

  while (TIMELINE_FILLER_PREFIX.test(nextValue)) {
    nextValue = nextValue.replace(TIMELINE_FILLER_PREFIX, '').trim();
  }

  return nextValue;
};

const cleanTimelineValue = (value: string): string =>
  stripLeadingFiller(value)
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:!?-]+/, '')
    .replace(/[.]+$/, '')
    .trim();

const extractBestPatternMatch = (value: string, patterns: RegExp[]): string => {
  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[0]) {
      return cleanTimelineValue(match[0]);
    }
  }

  return '';
};

const alignTimelineValueToUserVoice = (
  value: string,
  latestUserMessage: string
): string => {
  const cleanedLatestMessage = cleanTimelineValue(latestUserMessage);

  if (!cleanedLatestMessage) {
    return value;
  }

  let alignedValue = value;

  if (/\bmy\b/i.test(cleanedLatestMessage)) {
    alignedValue = alignedValue.replace(/\byour\b/gi, 'my');
  }

  if (/\bi was\b/i.test(cleanedLatestMessage)) {
    alignedValue = alignedValue.replace(/\byou were\b/gi, 'I was');
  } else if (/\bi am\b/i.test(cleanedLatestMessage)) {
    alignedValue = alignedValue.replace(/\byou are\b/gi, 'I am');
  } else if (/\bi'm\b/i.test(cleanedLatestMessage)) {
    alignedValue = alignedValue.replace(/\byou are\b/gi, "I'm");
  }

  if (/\bi\b/i.test(cleanedLatestMessage)) {
    alignedValue = alignedValue.replace(/\byou\b/gi, 'I');
  }

  return cleanTimelineValue(alignedValue);
};

const normalizeActivityContext = (value: string): string => {
  const cleanedValue = cleanTimelineValue(value);

  if (!cleanedValue) {
    return '';
  }

  const withoutLead = cleanedValue
    .replace(/^(?:while|when)\s+/i, '')
    .replace(/\bjust\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedActivity = withoutLead
    .replace(/\bi am\b/i, 'I was')
    .replace(/\bi'm\b/i, 'I was');

  return normalizedActivity ? `while ${normalizedActivity}` : '';
};

const buildShortWhatFromUserMessage = (latestUserMessage: string): string => {
  const cleanedLatestMessage = cleanTimelineValue(latestUserMessage);

  if (!cleanedLatestMessage) {
    return '';
  }

  const actionMatch = extractBestPatternMatch(
    cleanedLatestMessage,
    HARM_ACTION_PATTERNS
  );

  if (!actionMatch) {
    return '';
  }

  const activityMatch = extractBestPatternMatch(
    cleanedLatestMessage,
    ACTIVITY_CONTEXT_PATTERNS
  );
  const normalizedActivity = normalizeActivityContext(activityMatch);

  if (!normalizedActivity || actionMatch.toLowerCase().includes(normalizedActivity.toLowerCase())) {
    return cleanTimelineValue(actionMatch);
  }

  return cleanTimelineValue(`${actionMatch} ${normalizedActivity}`);
};

const compactTimelineFieldValue = (
  key: string,
  value: string,
  latestUserMessage = ''
): string => {
  const cleanedValue = cleanTimelineValue(value);

  if (!cleanedValue) {
    return '';
  }

  if (key === 'what') {
    const userVoiceWhat = buildShortWhatFromUserMessage(latestUserMessage);
    const actionMatch = extractBestPatternMatch(cleanedValue, HARM_ACTION_PATTERNS);
    const compactWhat = userVoiceWhat
      || alignTimelineValueToUserVoice(actionMatch || cleanedValue, latestUserMessage);

    return trimTimelineValueWords(compactWhat, TIMELINE_VALUE_WORD_LIMITS.what ?? 12);
  }

  if (key === 'where') {
    const locationMatch = extractBestPatternMatch(cleanedValue, WHERE_PATTERNS);
    const compactWhere = locationMatch || cleanedValue;

    return trimTimelineValueWords(compactWhere, TIMELINE_VALUE_WORD_LIMITS.where ?? 8);
  }

  if (key === 'when') {
    const whenMatch = extractBestPatternMatch(cleanedValue, WHEN_PATTERNS);
    const compactWhen = whenMatch || cleanedValue;

    return trimTimelineValueWords(compactWhen, TIMELINE_VALUE_WORD_LIMITS.when ?? 8);
  }

  return trimTimelineValueWords(
    alignTimelineValueToUserVoice(cleanedValue, latestUserMessage),
    TIMELINE_VALUE_WORD_LIMITS[key] ?? 12
  );
};

const compactTimelineObject = (
  timeline: Record<string, string>,
  latestUserMessage = ''
): Record<string, string> => {
  const compactedTimeline: Record<string, string> = {};

  for (const [key, value] of Object.entries(timeline)) {
    const compactValue = compactTimelineFieldValue(key, value, latestUserMessage);

    if (compactValue) {
      compactedTimeline[key] = compactValue;
    }
  }

  return compactedTimeline;
};

const INCIDENT_TYPE_PATTERNS: Array<{ value: string; patterns: RegExp[] }> = [
  {
    value: 'harassment',
    patterns: [/\bharass(?:ment|ing|ed)?\b/i, /\bharras(?:ment|ing|ed)?\b/i]
  },
  {
    value: 'bullying',
    patterns: [/\bbully(?:ing|ied)?\b/i]
  },
  {
    value: 'discrimination',
    patterns: [/\bdiscriminat(?:ion|e|ed|ing)\b/i, /\bracis[tm]\b/i]
  },
  {
    value: 'assault',
    patterns: [/\bassault(?:ed|ing)?\b/i, /\battacked?\b/i]
  },
  {
    value: 'abuse',
    patterns: [/\babus(?:e|ed|ing)\b/i, /\bdomestic violence\b/i]
  },
  {
    value: 'threats',
    patterns: [/\bthreat(?:s|ened|ening)?\b/i, /\bintimidat(?:e|ed|ion|ing)\b/i]
  },
  {
    value: 'scam',
    patterns: [/\bscam(?:med|ming)?\b/i, /\bfraud\b/i, /\bphishing\b/i]
  },
  {
    value: 'stalking',
    patterns: [/\bstalk(?:ed|ing)?\b/i]
  },
  {
    value: 'coercion',
    patterns: [/\bcoerc(?:e|ion|ed|ing)\b/i, /\bblackmail(?:ed|ing)?\b/i]
  }
];

const RELATIONSHIP_PATTERNS: Array<{ value: string; patterns: RegExp[] }> = [
  { value: 'wife', patterns: [/\bmy wife\b/i, /\bwife\b/i] },
  { value: 'husband', patterns: [/\bmy husband\b/i, /\bhusband\b/i] },
  { value: 'partner', patterns: [/\bmy partner\b/i, /\bpartner\b/i] },
  { value: 'boyfriend', patterns: [/\bmy boyfriend\b/i, /\bboyfriend\b/i] },
  { value: 'girlfriend', patterns: [/\bmy girlfriend\b/i, /\bgirlfriend\b/i] },
  { value: 'ex-partner', patterns: [/\bex[- ]?(partner|boyfriend|girlfriend|husband|wife)\b/i] },
  { value: 'boss', patterns: [/\bmy boss\b/i, /\bboss\b/i, /\bmanager\b/i] },
  { value: 'coworker', patterns: [/\bcoworker\b/i, /\bcolleague\b/i] },
  { value: 'teacher', patterns: [/\bteacher\b/i, /\bprofessor\b/i] },
  { value: 'neighbor', patterns: [/\bneighbou?r\b/i] },
  { value: 'friend', patterns: [/\bmy friend\b/i, /\bfriend\b/i] },
  { value: 'family member', patterns: [/\bfamily member\b/i, /\brelative\b/i] },
  { value: 'stranger', patterns: [/\bstranger\b/i] }
];

const LOCATION_PATTERNS: Array<{ value: string; patterns: RegExp[] }> = [
  { value: 'at home', patterns: [/\bat home\b/i, /\bin my house\b/i, /\bin my home\b/i] },
  { value: 'at work', patterns: [/\bat work\b/i, /\bin the office\b/i, /\bat the office\b/i] },
  { value: 'at school', patterns: [/\bat school\b/i, /\bon campus\b/i, /\bin class\b/i] }
];

const detectPatternValue = (
  text: string,
  definitions: Array<{ value: string; patterns: RegExp[] }>
): string => {
  for (const definition of definitions) {
    if (definition.patterns.some((pattern) => pattern.test(text))) {
      return definition.value;
    }
  }

  return '';
};

const buildTimelineFallback = (
  input: Pick<RagTimelineAssistantInput, 'message' | 'conversation' | 'timeline'>,
  timelineCandidate: Record<string, unknown>
): Record<string, string> => {
  const combinedTimeline = normalizeTimelineObject(input.timeline, timelineCandidate);
  const fallback: Record<string, string> = {};
  const latestMessage = input.message.trim();
  const conversationText = input.conversation.map((entry) => entry.content).join(' ');
  const combinedText = `${latestMessage} ${conversationText}`.trim();

  if (!combinedTimeline.what) {
    const incidentType = detectPatternValue(latestMessage || combinedText, INCIDENT_TYPE_PATTERNS)
      || detectPatternValue(combinedText, INCIDENT_TYPE_PATTERNS);

    if (incidentType) {
      fallback.what = incidentType;
    }
  }

  if (!combinedTimeline.relationship) {
    const relationship = detectPatternValue(combinedText, RELATIONSHIP_PATTERNS);

    if (relationship) {
      fallback.relationship = relationship;
    }
  }

  if (!combinedTimeline.who && fallback.relationship) {
    fallback.who = fallback.relationship;
  }

  if (!combinedTimeline.where) {
    const location = detectPatternValue(combinedText, LOCATION_PATTERNS);

    if (location) {
      fallback.where = location;
    }
  }

  return fallback;
};

export const runTimelineAssistant = async (
  context: RagServiceContext,
  input: RagTimelineAssistantInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);

  let results: RagSearchResult[] = [];
  let ragUnavailable = false;

  try {
    results = await searchRag(context, {
      query: input.message,
      topK: input.topK,
      language: input.language,
      jurisdiction: input.jurisdiction
    });
  } catch {
    ragUnavailable = true;
  }

  const contextText = results
    .map((result, index) => `[${index + 1}] ${result.title}: ${result.text}`)
    .join('\n\n');
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));

  const modelResponse = await generateTimelineAssistantTurn(context, {
    message: input.message,
    conversation: input.conversation,
    timeline: input.timeline,
    language: input.language,
    incidentCategory: input.incidentCategory,
    contextText,
    citations,
    ragUnavailable
  });
  const output = (modelResponse.output ?? {}) as Record<string, unknown>;
  const timelineCandidate = (output.timeline ?? {}) as Record<string, unknown>;
  const timelineFallback = buildTimelineFallback(input, timelineCandidate);
  const resolvedTimeline = compactTimelineObject(
    normalizeTimelineObject(input.timeline, timelineCandidate, timelineFallback),
    input.message
  );
  const assistantMessage =
    typeof output.assistantMessage === 'string' && output.assistantMessage.trim()
      ? enforceAiOutputGuardrails(output.assistantMessage)
      : enforceAiOutputGuardrails(
          'Thank you. Can you share one more detail that feels safe to add?'
        );

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    mode: 'timeline_assistant',
    citationCount: results.length,
    ragUnavailable
  });

  return {
    assistantMessage,
    nextQuestion:
      typeof output.nextQuestion === 'string' ? output.nextQuestion.trim() : '',
    timeline: resolvedTimeline,
    readyForSubmission: Boolean(output.readyForSubmission),
    confidence:
      output.confidence === 'high' || output.confidence === 'medium' || output.confidence === 'low'
        ? output.confidence
        : results.length >= 2
          ? 'medium'
          : 'low',
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: results.map((result) => ({
      title: result.title,
      publisher: result.publisher,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      sectionRef: result.sectionRef,
      lastUpdated: result.lastUpdated
    })),
    rag: {
      used: results.length > 0,
      unavailable: ragUnavailable,
      resultCount: results.length
    },
    reviewStatus: modelResponse.reviewStatus,
    interactionId: modelResponse.interactionId
  };
};
