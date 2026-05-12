import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { StatusCodes } from 'http-status-codes';
import type { FilterQuery, HydratedDocument, PipelineStage } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';
import {
  buildInformationOnlyDisclaimer,
  detectClinicalAdviceRisk,
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
  RAG_CHUNK_SIZE,
  RAG_GOVERNED_SOURCE_CATEGORIES,
  RAG_OFFICIAL_SOURCE_HOSTS
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
  RefreshKnowledgeSourceInput,
  RejectKnowledgeSourceInput,
  UpdateKnowledgeSourceInput
} from './rag.schema';
import type {
  RagJurisdiction,
  RagLegalAwareness,
  RagOwner,
  RagSearchResult,
  RagServiceContext,
  RagSourceCategory
} from './rag.types';

const ownerFilter = (owner: RagOwner): RagOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');
const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const GOVERNED_SOURCE_CATEGORIES = new Set<string>(RAG_GOVERNED_SOURCE_CATEGORIES);
const OFFICIAL_SOURCE_HOSTS = new Set<string>(RAG_OFFICIAL_SOURCE_HOSTS);
const OFFICIAL_REFRESH_TIMEOUT_MS = 15000;
const OFFICIAL_REFRESH_MAX_BYTES = 750000;
const OFFICIAL_REFRESH_DEFAULT_DAYS = 90;
const OFFICIAL_REFRESH_MIN_TEXT_LENGTH = 200;
const MATERIAL_REVIEW_FIELDS = new Set<keyof UpdateKnowledgeSourceInput>([
  'title',
  'description',
  'sourceCategory',
  'jurisdiction',
  'topic',
  'sourceType',
  'language',
  'url',
  'localFilePath',
  'publisher',
  'licenseStatus',
  'lastUpdated',
  'lastVerifiedAt',
  'nextReviewAt',
  'nextRefreshAt',
  'legalReviewed',
  'status'
]);

const assertAiConsent = async (owner: RagOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai consent is required for AI processing'
    );
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

const normalizeHostname = (value: string): string => value.toLowerCase().replace(/^www\./, '');

const isOfficialSourceUrl = (url: string): boolean => {
  try {
    const hostname = normalizeHostname(new URL(url).hostname);

    return Array.from(OFFICIAL_SOURCE_HOSTS).some(
      (officialHost) => hostname === officialHost || hostname.endsWith(`.${officialHost}`)
    );
  } catch {
    return false;
  }
};

const isGovernedKnowledgeSource = (sourceCategory?: string): boolean =>
  Boolean(sourceCategory && GOVERNED_SOURCE_CATEGORIES.has(sourceCategory));

const assertKnowledgeSourceGovernance = (input: {
  sourceCategory?: string;
  url?: string;
  sourceType?: string;
  publisher?: string;
  licenseStatus?: string;
  lastUpdated?: Date;
  nextRefreshAt?: Date;
}): void => {
  if (!isGovernedKnowledgeSource(input.sourceCategory)) {
    return;
  }

  if (!input.url || !isOfficialSourceUrl(input.url)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official legal/support knowledge sources must use an approved government, agency, or AustLII URL'
    );
  }

  if (input.sourceType === 'ProductRequirement' || input.sourceType === 'Policy') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official legal/support knowledge sources must be statutes, regulations, guidance, forms, decisions, reports, FAQs, support resources, or webpages'
    );
  }

  if (!input.publisher?.trim()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official legal/support knowledge sources require a publisher'
    );
  }

  if (!input.licenseStatus?.trim()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official legal/support knowledge sources require a license status'
    );
  }

  if (!input.lastUpdated) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official legal/support knowledge sources require lastUpdated metadata'
    );
  }

  if (!input.nextRefreshAt) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official legal/support knowledge sources require a nextRefreshAt refresh date'
    );
  }
};

const assertMergedKnowledgeSourceGovernance = (
  source: RagKnowledgeSourceDocument,
  input: UpdateKnowledgeSourceInput
): void => {
  assertKnowledgeSourceGovernance({
    sourceCategory: input.sourceCategory ?? source.sourceCategory,
    sourceType: input.sourceType ?? source.sourceType,
    url: input.url ?? source.url,
    publisher: input.publisher ?? source.publisher,
    licenseStatus: input.licenseStatus ?? source.licenseStatus,
    lastUpdated: input.lastUpdated ?? source.lastUpdated,
    nextRefreshAt: input.nextRefreshAt ?? source.nextRefreshAt
  });
};

const hasMaterialReviewChange = (input: UpdateKnowledgeSourceInput): boolean =>
  Object.keys(input).some((key) =>
    MATERIAL_REVIEW_FIELDS.has(key as keyof UpdateKnowledgeSourceInput)
  );

const clearApprovalState = (source: HydratedRagKnowledgeSourceDocument): void => {
  source.status = 'pending_review';
  source.approvedBy = undefined;
  source.approvedAt = undefined;
};

const clearLegalReviewState = (source: HydratedRagKnowledgeSourceDocument): void => {
  source.legalReviewed = false;
  source.legalReviewedBy = undefined;
  source.legalReviewedAt = undefined;
};

const isDateExpired = (value?: Date): boolean => Boolean(value && value.getTime() <= Date.now());

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);

  return next;
};

const isNswSpecificJurisdiction = (jurisdiction: RagJurisdiction): boolean =>
  !['Cth', 'AU', 'Global', 'Internal'].includes(jurisdiction);

const buildJurisdictionFilter = (
  jurisdiction: RagJurisdiction | undefined,
  category: RagSourceCategory
): FilterQuery<RagKnowledgeSourceDocument> => {
  if (!jurisdiction) {
    return {};
  }

  if (isGovernedKnowledgeSource(category) && isNswSpecificJurisdiction(jurisdiction)) {
    return { jurisdiction: { $in: [jurisdiction, 'Cth', 'AU'] } };
  }

  return { jurisdiction };
};

type HydratedRagKnowledgeSourceDocument = HydratedDocument<RagKnowledgeSourceDocument>;

const getSource = async (sourceId: string): Promise<HydratedRagKnowledgeSourceDocument> => {
  const source = await RagKnowledgeSourceModel.findOne({
    _id: sourceId,
    deletedAt: { $exists: false }
  });

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

type KnowledgeSourceTextInput = Pick<IngestKnowledgeSourceInput, 'content' | 'localFilePath'>;

const readIngestionText = async (input: KnowledgeSourceTextInput): Promise<string> => {
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
  source: Pick<
    RagKnowledgeSourceDocument,
    'title' | 'jurisdiction' | 'sourceType' | 'sourceCategory'
  >
): Record<string, unknown> => {
  const actNameMatches = Array.from(
    text.matchAll(
      /\b([A-Z][A-Za-z'’().,&/-]+(?:\s+[A-Z][A-Za-z'’().,&/-]+){0,8}\s+(?:Act|Regulation|Code|Charter|Constitution|Policy))\b/g
    )
  ).map((match) => match[1]?.trim() ?? '');
  const sectionMatches = Array.from(
    text.matchAll(
      /\b(?:s|sec|section|sections|pt|part|cl|clause|art|article)\.?\s*([0-9A-Za-z().,-]+)/gi
    )
  ).map((match) => match[0]?.trim() ?? '');
  const constitutionalMentions = Array.from(
    text.matchAll(/\b(constitution|constitutional|human rights|bill of rights|implied freedom)\b/gi)
  ).map((match) => match[1]?.trim() ?? '');
  const courtMatches = Array.from(
    text.matchAll(
      /\b(High Court|Federal Court|Supreme Court|Local Court|District Court|Tribunal)\b/gi
    )
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

type OfficialFetchResult =
  | {
      kind: 'metadata_only';
      message: string;
      contentType?: string;
      contentLength?: number;
      lastModified?: Date;
      sha256Hash?: string;
    }
  | {
      kind: 'text';
      text: string;
      contentType?: string;
      contentLength?: number;
      lastModified?: Date;
      sha256Hash: string;
    };

const isDocumentSource = (url: URL, contentType: string): boolean =>
  /\.(pdf|doc|docx|rtf)$/i.test(url.pathname) ||
  /pdf|msword|officedocument|rtf|octet-stream/i.test(contentType);

const parseHeaderDate = (value: string | null): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseContentLength = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const htmlToText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const normalizeFetchedText = (body: string, contentType: string): string => {
  if (/html|xml/i.test(contentType) || /<html|<body|<article/i.test(body)) {
    return htmlToText(body);
  }

  return body.replace(/\s+/g, ' ').trim();
};

const fetchOfficialSourceText = async (rawUrl: string): Promise<OfficialFetchResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFFICIAL_REFRESH_TIMEOUT_MS);

  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf,*/*;q=0.8',
        'User-Agent': 'SafeSpeak-RAG-Refresh/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const url = new URL(rawUrl);
    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = parseContentLength(response.headers.get('content-length'));
    const lastModified = parseHeaderDate(response.headers.get('last-modified'));

    if (isDocumentSource(url, contentType)) {
      const bytes = Buffer.from(await response.arrayBuffer());

      return {
        kind: 'metadata_only',
        contentType,
        contentLength: contentLength ?? bytes.length,
        lastModified,
        sha256Hash: hashBytes(bytes),
        message:
          'Binary or document-style official source was stored as metadata only. Extract text manually before chunking it for RAG.'
      };
    }

    const body = await response.text();

    if (body.length > OFFICIAL_REFRESH_MAX_BYTES) {
      return {
        kind: 'metadata_only',
        contentType,
        contentLength: contentLength ?? body.length,
        lastModified,
        sha256Hash: hashText(body),
        message: `Fetched official source exceeded ${OFFICIAL_REFRESH_MAX_BYTES} characters and was stored as metadata only.`
      };
    }

    const text = normalizeFetchedText(body, contentType);

    if (text.length < OFFICIAL_REFRESH_MIN_TEXT_LENGTH) {
      return {
        kind: 'metadata_only',
        contentType,
        contentLength: contentLength ?? body.length,
        lastModified,
        sha256Hash: hashText(body),
        message: 'Readable official-source text could not be extracted safely.'
      };
    }

    return {
      kind: 'text',
      text,
      contentType,
      contentLength: contentLength ?? body.length,
      lastModified,
      sha256Hash: hashText(text)
    };
  } finally {
    clearTimeout(timeout);
  }
};

type EmbedKnowledgeSourceTextOptions = {
  expectedSha256?: string;
  metadata?: Record<string, unknown>;
  verificationDate?: Date;
  nextRefreshAt?: Date;
  lastUpdated?: Date;
  contentType?: string;
  contentLength?: number;
  refreshMode?: string;
  preserveApprovalOnUnchanged?: boolean;
};

const embedKnowledgeSourceText = async (
  source: HydratedRagKnowledgeSourceDocument,
  text: string,
  options: EmbedKnowledgeSourceTextOptions
): Promise<{
  chunkCount: number;
  sha256Hash: string;
  extractedLegalMetadata: Record<string, unknown>;
  hashChanged: boolean;
}> => {
  const sha256Hash = hashText(text);

  if (options.expectedSha256 && options.expectedSha256.toLowerCase() !== sha256Hash) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Knowledge source SHA-256 verification failed');
  }

  const previousHash = source.sha256Hash;
  const hashChanged = previousHash !== sha256Hash;
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
        ...options.metadata,
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

  const verificationDate = options.verificationDate ?? new Date();
  const nextRefreshAt =
    options.nextRefreshAt ??
    (isGovernedKnowledgeSource(source.sourceCategory)
      ? addDays(verificationDate, OFFICIAL_REFRESH_DEFAULT_DAYS)
      : source.nextRefreshAt);

  if (source.sourceCategory !== 'internal_product_rule') {
    const canKeepApproval =
      Boolean(options.preserveApprovalOnUnchanged) &&
      source.status === 'approved' &&
      !hashChanged &&
      !isDateExpired(nextRefreshAt);

    if (!canKeepApproval) {
      clearApprovalState(source);

      if (source.sourceCategory === 'official_legal_source' && hashChanged) {
        clearLegalReviewState(source);
      }
    }
  }

  source.ingestedAt = verificationDate;
  source.fetchedAt = verificationDate;
  source.lastVerifiedAt = verificationDate;
  source.lastUpdated = options.lastUpdated ?? source.lastUpdated;
  source.nextRefreshAt = nextRefreshAt;
  source.ingestionStatus = 'embedded';
  source.ingestionError = undefined;
  source.version = (source.version ?? 1) + (hashChanged ? 1 : 0);
  source.metadata = {
    ...source.metadata,
    ...options.metadata,
    ...extractedLegalMetadata,
    chunkCount: embeddedChunks.length,
    sha256Verified: true,
    contentHashChanged: hashChanged,
    refreshMode: options.refreshMode,
    contentType: options.contentType,
    contentLength: options.contentLength,
    lastVerifiedAt: verificationDate.toISOString()
  };
  await source.save();

  return {
    chunkCount: embeddedChunks.length,
    sha256Hash,
    extractedLegalMetadata,
    hashChanged
  };
};

export const listKnowledgeSources = async (): Promise<unknown[]> =>
  RagKnowledgeSourceModel.find({ deletedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .lean();

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

  assertKnowledgeSourceGovernance(input);

  const source = await RagKnowledgeSourceModel.create({
    ...input,
    createdBy: context.owner.userId,
    legalReviewedBy: input.legalReviewed ? context.owner.userId : undefined,
    legalReviewedAt: input.legalReviewed ? new Date() : undefined,
    lastVerifiedAt: input.lastVerifiedAt ?? new Date()
  });

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
  assertMergedKnowledgeSourceGovernance(source, input);

  const shouldReturnToReview =
    source.status === 'approved' && hasMaterialReviewChange(input) && input.status === undefined;
  const legalReviewedChanged =
    input.legalReviewed !== undefined && input.legalReviewed !== source.legalReviewed;

  source.set(input);

  if (legalReviewedChanged) {
    source.legalReviewedBy = input.legalReviewed ? (context.owner.userId as never) : undefined;
    source.legalReviewedAt = input.legalReviewed ? new Date() : undefined;
  }

  if (hasMaterialReviewChange(input)) {
    source.lastVerifiedAt = input.lastVerifiedAt ?? new Date();
  }

  if (shouldReturnToReview) {
    clearApprovalState(source);
  }

  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceUpdate, source._id.toString(), {
    changedFields: Object.keys(input),
    returnedToReview: shouldReturnToReview
  });

  return source;
};

export const deleteKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<void> => {
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
  assertMergedKnowledgeSourceGovernance(source, {});

  source.ingestionStatus = 'fetched';
  source.ingestionError = undefined;
  await source.save();

  try {
    const text = await readIngestionText(input);
    const result = await embedKnowledgeSourceText(source, text, {
      expectedSha256: input.expectedSha256,
      metadata: input.metadata,
      refreshMode: 'admin_ingest'
    });

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      requiresHumanReview: source.status !== 'approved'
    });

    return {
      source,
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      extractedLegalMetadata: result.extractedLegalMetadata,
      reviewStatus: 'pending_human_review'
    };
  } catch (error) {
    source.ingestionStatus = 'failed';
    source.ingestionError =
      error instanceof Error ? error.message : 'Knowledge source ingestion failed';
    await source.save();
    throw error;
  }
};

export const refreshKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: RefreshKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  assertMergedKnowledgeSourceGovernance(source, {});

  if (!source.url && !input.content && !input.localFilePath) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official source refresh requires a URL or extracted text content'
    );
  }

  if (
    isGovernedKnowledgeSource(source.sourceCategory) &&
    source.url &&
    !isOfficialSourceUrl(source.url)
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Official source refresh requires an approved government, agency, or AustLII URL'
    );
  }

  const verificationDate = new Date();
  source.ingestionStatus = 'fetched';
  source.ingestionError = undefined;
  source.fetchedAt = verificationDate;
  await source.save();

  try {
    if (input.content || input.localFilePath) {
      const text = await readIngestionText(input);
      const result = await embedKnowledgeSourceText(source, text, {
        expectedSha256: input.expectedSha256,
        metadata: input.metadata,
        verificationDate,
        nextRefreshAt: input.nextRefreshAt,
        refreshMode: 'admin_extracted_text',
        preserveApprovalOnUnchanged: true
      });

      await auditRagAction(context, RAG_ACTIONS.sourceRefresh, source._id.toString(), {
        mode: 'admin_extracted_text',
        chunkCount: result.chunkCount,
        sha256Hash: result.sha256Hash,
        hashChanged: result.hashChanged,
        requiresHumanReview: source.status !== 'approved'
      });

      return {
        source,
        chunkCount: result.chunkCount,
        sha256Hash: result.sha256Hash,
        extractedLegalMetadata: result.extractedLegalMetadata,
        metadataOnly: false,
        ingestionStatus: source.ingestionStatus,
        reviewStatus: source.status === 'approved' ? 'approved_current' : 'pending_human_review'
      };
    }

    const fetched = await fetchOfficialSourceText(source.url as string);

    if (fetched.kind === 'metadata_only') {
      const hashChanged = Boolean(fetched.sha256Hash && fetched.sha256Hash !== source.sha256Hash);

      await RagChunkModel.deleteMany({ sourceId: source._id });
      source.rawText = undefined;
      source.ingestedAt = undefined;
      source.fetchedAt = verificationDate;
      source.lastVerifiedAt = verificationDate;
      source.lastUpdated = fetched.lastModified ?? source.lastUpdated;
      source.nextRefreshAt =
        input.nextRefreshAt ?? addDays(verificationDate, OFFICIAL_REFRESH_DEFAULT_DAYS);
      source.sha256Hash =
        fetched.sha256Hash ?? hashText(`${source.url}:${verificationDate.toISOString()}`);
      source.ingestionStatus = 'metadata_only';
      source.ingestionError = undefined;
      source.version = (source.version ?? 1) + (hashChanged ? 1 : 0);

      if (isGovernedKnowledgeSource(source.sourceCategory)) {
        clearApprovalState(source);

        if (source.sourceCategory === 'official_legal_source') {
          clearLegalReviewState(source);
        }
      }

      source.metadata = {
        ...source.metadata,
        ...input.metadata,
        chunkCount: 0,
        sha256Verified: Boolean(fetched.sha256Hash),
        contentHashChanged: hashChanged,
        refreshMode: 'metadata_only',
        refreshMessage: fetched.message,
        contentType: fetched.contentType,
        contentLength: fetched.contentLength,
        lastVerifiedAt: verificationDate.toISOString()
      };
      await source.save();

      await auditRagAction(context, RAG_ACTIONS.sourceRefresh, source._id.toString(), {
        mode: 'metadata_only',
        message: fetched.message,
        sha256Hash: source.sha256Hash,
        hashChanged,
        requiresHumanReview: true
      });

      return {
        source,
        chunkCount: 0,
        sha256Hash: source.sha256Hash,
        metadataOnly: true,
        ingestionStatus: source.ingestionStatus,
        message: fetched.message,
        reviewStatus: 'metadata_only_needs_extracted_text'
      };
    }

    const result = await embedKnowledgeSourceText(source, fetched.text, {
      expectedSha256: input.expectedSha256,
      metadata: input.metadata,
      verificationDate,
      nextRefreshAt: input.nextRefreshAt,
      lastUpdated: fetched.lastModified,
      contentType: fetched.contentType,
      contentLength: fetched.contentLength,
      refreshMode: 'official_url_fetch',
      preserveApprovalOnUnchanged: true
    });

    await auditRagAction(context, RAG_ACTIONS.sourceRefresh, source._id.toString(), {
      mode: 'official_url_fetch',
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      hashChanged: result.hashChanged,
      requiresHumanReview: source.status !== 'approved'
    });

    return {
      source,
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      extractedLegalMetadata: result.extractedLegalMetadata,
      metadataOnly: false,
      ingestionStatus: source.ingestionStatus,
      reviewStatus: source.status === 'approved' ? 'approved_current' : 'pending_human_review'
    };
  } catch (error) {
    source.ingestionStatus = 'failed';
    source.ingestionError =
      error instanceof Error ? error.message : 'Knowledge source refresh failed';
    source.lastVerifiedAt = verificationDate;
    await source.save();
    throw error;
  }
};

export const approveKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
  const owner = ownerFilter(context.owner);
  const source = await getSource(sourceId);
  assertMergedKnowledgeSourceGovernance(source, {});

  if (source.sourceCategory === 'official_legal_source' && !source.legalReviewed) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Legal knowledge sources require legalReviewed=true before approval'
    );
  }

  if (isDateExpired(source.nextReviewAt)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Knowledge source review date has expired; refresh before approval'
    );
  }

  if (isGovernedKnowledgeSource(source.sourceCategory) && isDateExpired(source.nextRefreshAt)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Knowledge source refresh date has expired; refresh before approval'
    );
  }

  if (source.createdBy && owner.userId && source.createdBy.toString() === owner.userId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Knowledge sources must be approved by a different admin'
    );
  }

  source.status = 'approved';
  source.approvedBy = context.owner.userId as never;
  source.approvedAt = new Date();
  source.lastVerifiedAt = new Date();
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

  await auditRagAction(context, RAG_ACTIONS.sourceReject, source._id.toString(), {
    reason: input.reason
  });

  return source;
};

export const reindexKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
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
  if (
    /(law|legal|legislation|act|rights|court|discrimination|racial abuse|racial hatred|vilification|harassment|employer|what are my options)/i.test(
      q
    )
  ) {
    return 'official_legal_source';
  }
  if (/(support|helpline|000|1800respect|lifeline|reportcyber|scamwatch)/i.test(q))
    return 'official_support_source';
  return 'internal_product_rule';
};

const shouldAttachNswLegalAwareness = (input: {
  text: string;
  jurisdiction?: RagJurisdiction;
  incidentCategory?: string;
  category?: RagSourceCategory;
}): boolean => {
  if (input.jurisdiction && input.jurisdiction !== 'NSW') {
    return false;
  }

  if (
    input.incidentCategory === 'racial_abuse' ||
    input.incidentCategory === 'migrant_challenges'
  ) {
    return true;
  }

  if (input.category === 'official_legal_source') {
    return /nsw|new south wales|racial|racis[mt]|discriminat|vilification|migrant|workplace|school|housing/i.test(
      input.text
    );
  }

  return (
    /nsw|new south wales/i.test(input.text) &&
    /racial|racis[mt]|discriminat|migrant/i.test(input.text)
  );
};

const buildNswLegalAwareness = (input: {
  sourceStatus: RagLegalAwareness['sourceStatus'];
  topic?: 'racial_abuse' | 'migrant_challenges';
}): RagLegalAwareness => {
  const topic = input.topic ?? 'racial_abuse';

  return {
    jurisdiction: 'NSW',
    topic,
    informationOnly: true,
    sourceStatus: input.sourceStatus,
    keyPoints: [
      'Keep a dated record of what happened if it is safe to do so.',
      'Racial discrimination, vilification, or victimisation concerns may have NSW and Commonwealth information pathways.',
      'Online abuse may also involve platform reporting, eSafety information, or urgent safety support depending on the situation.'
    ],
    pathwayCards: [
      {
        title: 'NSW discrimination pathway',
        body: 'For NSW incidents, SafeSpeak can point to Anti-Discrimination NSW complaint information after approved sources are available.',
        sourceRequirement: 'Requires approved NSW source before detailed legal explanation.'
      },
      {
        title: 'Commonwealth race discrimination pathway',
        body: 'Some racial discrimination concerns may also involve Australian Human Rights Commission information.',
        sourceRequirement: 'Cite only approved Commonwealth sources in generated answers.'
      },
      {
        title: 'Online abuse pathway',
        body: 'If the conduct happened online, eSafety information may be relevant alongside evidence collection and safety planning.',
        sourceRequirement: 'Use approved eSafety support sources before public citation.'
      }
    ],
    citationPolicy:
      input.sourceStatus === 'approved_sources_used'
        ? 'Only approved, current, legally reviewed sources are included as citations.'
        : 'No citations are shown until approved, current, legally reviewed sources are available.'
  };
};

const buildSourceFilter = (
  input: RagSearchInput,
  category: RagSourceCategory
): FilterQuery<RagKnowledgeSourceDocument> => {
  const now = new Date();

  return {
    status: 'approved',
    deletedAt: { $exists: false },
    sourceCategory: category,
    ...(category === 'official_legal_source' ? { legalReviewed: true } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...buildJurisdictionFilter(input.jurisdiction, category),
    ...(input.topic ? { topic: input.topic } : {}),
    ...(isGovernedKnowledgeSource(category)
      ? {
          nextRefreshAt: { $gt: now },
          $or: [{ nextReviewAt: { $exists: false } }, { nextReviewAt: { $gt: now } }]
        }
      : {})
  };
};

const isVectorSearchUnavailable = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return /SearchNotEnabled|vectorSearch|search index|index .*not found/i.test(message);
};

const buildFallbackAnswer = (
  question: string,
  category: RagSourceCategory,
  flags: {
    crisisRisk: boolean;
    legalAdviceRisk: boolean;
    clinicalAdviceRisk: boolean;
    insufficientSources: boolean;
  },
  fallbackReason: 'insufficient_sources' | 'vector_unavailable',
  legalAwareness?: RagLegalAwareness
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
      safetyFlags: flags,
      legalAwareness
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
      safetyFlags: flags,
      legalAwareness
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
      safetyFlags: flags,
      legalAwareness
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
      safetyFlags: flags,
      legalAwareness
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
      safetyFlags: flags,
      legalAwareness
    };
  }

  return {
    answer: reasonText,
    disclaimer,
    citations: [],
    sourceCategoriesUsed: [],
    confidence: 'low',
    pendingHumanReview: true,
    safetyFlags: flags,
    legalAwareness
  };
};

export const searchRag = async (
  context: RagServiceContext,
  input: RagSearchInput
): Promise<RagSearchResult[]> => {
  await assertAiConsent(context.owner);
  const sourceCategory = classifySourceCategory(input);
  const sourceFilter = buildSourceFilter(input, sourceCategory);
  const sourceIds = await RagKnowledgeSourceModel.find(sourceFilter)
    .sort({ lastUpdated: -1 })
    .distinct('_id');

  if (sourceIds.length === 0) {
    return [];
  }

  const queryVector = await createEmbedding(input.query);

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
    {
      $lookup: {
        from: 'ragknowledgesources',
        localField: 'sourceId',
        foreignField: '_id',
        as: 'source'
      }
    },
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
  await auditRagAction(context, RAG_ACTIONS.search, undefined, {
    resultCount: results.length,
    topK: input.topK ?? DEFAULT_RAG_TOP_K
  });

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

export const answerRag = async (
  context: RagServiceContext,
  input: RagAnswerInput
): Promise<Record<string, unknown>> => {
  const category = classifySourceCategory(input);
  let results: RagSearchResult[] = [];
  let fallbackReason: 'insufficient_sources' | 'vector_unavailable' = 'insufficient_sources';
  const includeNswLegalAwareness = shouldAttachNswLegalAwareness({
    text: input.question,
    jurisdiction: input.jurisdiction,
    category
  });

  try {
    results = await searchRag(context, {
      ...input,
      query: input.question,
      sourceCategory: category
    });
  } catch (error) {
    if (!isVectorSearchUnavailable(error)) {
      throw error;
    }

    fallbackReason = 'vector_unavailable';
  }

  const insufficientSources = results.length === 0;
  const legalAwareness = includeNswLegalAwareness
    ? buildNswLegalAwareness({
        sourceStatus: insufficientSources
          ? 'insufficient_approved_sources'
          : 'approved_sources_used',
        topic: /migrant/i.test(input.question) ? 'migrant_challenges' : 'racial_abuse'
      })
    : undefined;
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));

  const safetySeedText = `${input.question}\n${results.map((r) => r.text).join('\n')}`;
  const legalAdviceRisk = detectLegalAdviceRisk(safetySeedText);
  const clinicalAdviceRisk = detectClinicalAdviceRisk(safetySeedText);
  const crisisRisk = detectCrisisRisk(safetySeedText);
  const pendingHumanReview = shouldRequireHumanReview({
    legalAdviceRisk,
    clinicalAdviceRisk,
    crisisRisk,
    insufficientSources
  });

  if (insufficientSources) {
    return buildFallbackAnswer(
      input.question,
      category,
      { crisisRisk, legalAdviceRisk, clinicalAdviceRisk, insufficientSources },
      fallbackReason,
      legalAwareness
    );
  }

  const contextText = results
    .map((result, index) => `[${index + 1}] ${result.title}: ${result.text}`)
    .join('\n\n');

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

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    citationCount: results.length,
    sourceCategory: category
  });

  return {
    answer: answerText,
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: results.map((result) => ({
      sourceId: result.sourceId,
      title: result.title,
      publisher: result.publisher,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      sourceCategory: result.sourceCategory,
      sourceType: result.sourceType,
      topic: result.topic,
      sectionRef: result.sectionRef,
      lastUpdated: result.lastUpdated
    })),
    sourceCategoriesUsed: Array.from(new Set(results.map((result) => result.sourceCategory))),
    confidence: results.length >= 4 ? 'high' : results.length >= 2 ? 'medium' : 'low',
    pendingHumanReview,
    safetyFlags: { crisisRisk, legalAdviceRisk, clinicalAdviceRisk, insufficientSources },
    legalAwareness
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

const alignTimelineValueToUserVoice = (value: string, latestUserMessage: string): string => {
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

  const normalizedActivity = withoutLead.replace(/\bi am\b/i, 'I was').replace(/\bi'm\b/i, 'I was');

  return normalizedActivity ? `while ${normalizedActivity}` : '';
};

const buildShortWhatFromUserMessage = (latestUserMessage: string): string => {
  const cleanedLatestMessage = cleanTimelineValue(latestUserMessage);

  if (!cleanedLatestMessage) {
    return '';
  }

  const actionMatch = extractBestPatternMatch(cleanedLatestMessage, HARM_ACTION_PATTERNS);

  if (!actionMatch) {
    return '';
  }

  const activityMatch = extractBestPatternMatch(cleanedLatestMessage, ACTIVITY_CONTEXT_PATTERNS);
  const normalizedActivity = normalizeActivityContext(activityMatch);

  if (!normalizedActivity || actionMatch.toLowerCase().includes(normalizedActivity.toLowerCase())) {
    return cleanTimelineValue(actionMatch);
  }

  return cleanTimelineValue(`${actionMatch} ${normalizedActivity}`);
};

const compactTimelineFieldValue = (key: string, value: string, latestUserMessage = ''): string => {
  const cleanedValue = cleanTimelineValue(value);

  if (!cleanedValue) {
    return '';
  }

  if (key === 'what') {
    const userVoiceWhat = buildShortWhatFromUserMessage(latestUserMessage);
    const actionMatch = extractBestPatternMatch(cleanedValue, HARM_ACTION_PATTERNS);
    const compactWhat =
      userVoiceWhat ||
      alignTimelineValueToUserVoice(actionMatch || cleanedValue, latestUserMessage);

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
    const incidentType =
      detectPatternValue(latestMessage || combinedText, INCIDENT_TYPE_PATTERNS) ||
      detectPatternValue(combinedText, INCIDENT_TYPE_PATTERNS);

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
  const legalAwareness = shouldAttachNswLegalAwareness({
    text: input.message,
    jurisdiction: input.jurisdiction,
    incidentCategory: input.incidentCategory,
    category: classifySourceCategory({ query: input.message } as RagSearchInput)
  })
    ? buildNswLegalAwareness({
        sourceStatus:
          results.length > 0 ? 'approved_sources_used' : 'insufficient_approved_sources',
        topic:
          input.incidentCategory === 'migrant_challenges' ? 'migrant_challenges' : 'racial_abuse'
      })
    : undefined;

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    mode: 'timeline_assistant',
    citationCount: results.length,
    ragUnavailable
  });

  return {
    assistantMessage,
    nextQuestion: typeof output.nextQuestion === 'string' ? output.nextQuestion.trim() : '',
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
      sourceId: result.sourceId,
      title: result.title,
      publisher: result.publisher,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      sourceCategory: result.sourceCategory,
      sourceType: result.sourceType,
      topic: result.topic,
      sectionRef: result.sectionRef,
      lastUpdated: result.lastUpdated
    })),
    legalAwareness,
    rag: {
      used: results.length > 0,
      unavailable: ragUnavailable,
      resultCount: results.length
    },
    reviewStatus: modelResponse.reviewStatus,
    interactionId: modelResponse.interactionId
  };
};
