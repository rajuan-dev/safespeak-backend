import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StatusCodes } from 'http-status-codes';
import type { FilterQuery, HydratedDocument, PipelineStage } from 'mongoose';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { ApiError } from '@common/errors/ApiError';
import { logger } from '@common/utils/logger';
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
  createEmbeddings,
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
  type RagChunkDocument,
  type RagKnowledgeSourceDocument
} from './rag.model';
import {
  getExpectedEmbeddingDimension,
  getPineconeIndexName,
  getPineconeNamespace,
  isPineconeConfigured,
  pineconeVectorStore
} from './pinecone-vector.service';
import {
  normalizeKnowledgeSourceInput,
  normalizeKnowledgeSourceMetadata
} from './rag.normalization';
import type {
  CreateKnowledgeSourceInput,
  KnowledgeSourceChunkQueryInput,
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
  RagKnowledgeReadinessBlocker,
  RagKnowledgeReadinessCoverageCell,
  RagLegalAwareness,
  RagOwner,
  RagSearchResult,
  RagServiceContext,
  RagKnowledgeSourceReadiness,
  RagSourceCategory,
  RagTopic,
  RagVectorIndexReadiness
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
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072
};
const KNOWLEDGE_DOCUMENT_STORAGE_ROOT = path.resolve('./storage/rag-knowledge-sources');
const KNOWLEDGE_DOCUMENT_MAX_BYTES = 52428800;
const KNOWLEDGE_SOURCE_ADMIN_TEXT_PREVIEW_CHARS = 3000;
const KNOWLEDGE_SOURCE_ADMIN_ERROR_PREVIEW_CHARS = 500;
const KNOWLEDGE_SOURCE_CHUNK_PREVIEW_DEFAULT_LIMIT = 25;
const KNOWLEDGE_SOURCE_CHUNK_PREVIEW_MAX_LIMIT = 50;
const EMBEDDING_BATCH_MAX_CHUNKS = 50;
const EMBEDDING_BATCH_MAX_ESTIMATED_TOKENS = 30000;
const PINECONE_UPSERT_BATCH_SIZE = 50;
const MONGO_CHUNK_WRITE_BATCH_SIZE = 50;
const LARGE_DOCUMENT_PAGE_WARNING_THRESHOLD = 100;
const LARGE_DOCUMENT_CHUNK_WARNING_THRESHOLD = 1000;
const MAX_BATCH_ATTEMPTS = 2;
const SEARCH_READINESS_DELAY_MS = 30000;
const KNOWLEDGE_DOCUMENT_ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.md',
  '.html',
  '.htm',
  '.csv',
  '.json'
]);
const KNOWLEDGE_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/json'
]);
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

export type RagKnowledgeSourceApprovalBlockerCode =
  | 'source_not_approvable'
  | 'ingestion_failed'
  | 'legal_review_missing'
  | 'review_expired'
  | 'refresh_expired';

export interface RagKnowledgeSourceApprovalBlocker {
  code: RagKnowledgeSourceApprovalBlockerCode;
  message: string;
  statusCode: number;
}

type ApprovalSourceSnapshot = Pick<
  RagKnowledgeSourceDocument,
  | 'sourceCategory'
  | 'ingestionStatus'
  | 'legalReviewed'
  | 'nextReviewAt'
  | 'nextRefreshAt'
  | 'status'
>;

export const getKnowledgeSourceApprovalBlocker = (
  source: ApprovalSourceSnapshot,
  now = new Date()
): RagKnowledgeSourceApprovalBlocker | undefined => {
  if (source.status === 'archived' || source.status === 'expired') {
    return {
      code: 'source_not_approvable',
      statusCode: StatusCodes.CONFLICT,
      message: 'Archived or expired knowledge sources cannot be approved'
    };
  }

  if (source.ingestionStatus === 'failed' || source.ingestionStatus === 'partial_index_failed') {
    return {
      code: 'ingestion_failed',
      statusCode: StatusCodes.CONFLICT,
      message: 'Failed or partially indexed knowledge sources cannot be approved'
    };
  }

  if (source.sourceCategory === 'official_legal_source' && !source.legalReviewed) {
    return {
      code: 'legal_review_missing',
      statusCode: StatusCodes.FORBIDDEN,
      message: 'Legal knowledge sources require legalReviewed=true before approval'
    };
  }

  if (source.nextReviewAt && source.nextReviewAt.getTime() <= now.getTime()) {
    return {
      code: 'review_expired',
      statusCode: StatusCodes.CONFLICT,
      message: 'Knowledge source review date has expired; refresh before approval'
    };
  }

  if (
    isGovernedKnowledgeSource(source.sourceCategory) &&
    source.nextRefreshAt &&
    source.nextRefreshAt.getTime() <= now.getTime()
  ) {
    return {
      code: 'refresh_expired',
      statusCode: StatusCodes.CONFLICT,
      message: 'Knowledge source refresh date has expired; refresh before approval'
    };
  }

  return undefined;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);

  return next;
};

type GovernedRagSourceCategory = Extract<
  RagSourceCategory,
  'official_legal_source' | 'official_support_source'
>;

type ReadinessBlockerCode = RagKnowledgeReadinessBlocker['code'];

const READINESS_BLOCKER_LABELS: Record<ReadinessBlockerCode, string> = {
  not_approved: 'Not approved',
  legal_review_missing: 'Legal review missing',
  refresh_due_or_missing: 'Refresh due or missing',
  not_embedded: 'Not embedded',
  no_chunks: 'No indexed chunks',
  official_url_missing_or_unapproved: 'Official URL missing or not allow-listed',
  ingestion_failed: 'Ingestion failed',
  metadata_only_needs_text: 'Metadata-only source needs extracted text',
  openai_api_key_missing: 'OpenAI API key missing',
  vector_index_missing: 'Vector index missing',
  vector_search_unavailable: 'Vector search unavailable',
  vector_index_check_failed: 'Vector index check failed'
};

const isGovernedSourceCategory = (
  value: RagSourceCategory
): value is GovernedRagSourceCategory =>
  value === 'official_legal_source' || value === 'official_support_source';

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
type SearchReadinessStatus =
  NonNullable<RagKnowledgeSourceDocument['metadata']['searchReadinessStatus']>;

const getSearchableAt = (date = new Date()): string =>
  new Date(date.getTime() + SEARCH_READINESS_DELAY_MS).toISOString();

const withSearchReadiness = (
  metadata: Record<string, unknown>,
  status: SearchReadinessStatus,
  searchableAt?: string
): Record<string, unknown> => ({
  ...metadata,
  searchReadinessStatus: status,
  searchableAt
});

const resolveSearchReadinessStatus = (
  metadata: Record<string, unknown>
): SearchReadinessStatus => {
  const status = metadataString(metadata, 'searchReadinessStatus') as
    | SearchReadinessStatus
    | undefined;

  if (status === 'indexed_pending_search') {
    const searchableAt = metadataString(metadata, 'searchableAt');

    if (searchableAt && new Date(searchableAt).getTime() <= Date.now()) {
      return 'searchable';
    }
  }

  return status ?? 'not_indexed';
};

const decorateSourceReadiness = <T extends { metadata?: unknown }>(source: T): T => {
  const metadata = toMetadataRecord(source.metadata);

  return {
    ...source,
    metadata: {
      ...metadata,
      searchReadinessStatus: resolveSearchReadinessStatus(metadata)
    }
  };
};

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

type LegislationChunkCandidate = {
  text: string;
  sectionNumber?: string;
  sectionHeading?: string;
  part?: string;
  division?: string;
  schedule?: string;
  pageStart?: number;
  pageEnd?: number;
};

const LEGISLATION_TARGET_CHARS = 4200;
const LEGISLATION_MAX_CHARS = 6000;
const LEGISLATION_OVERLAP_CHARS = 500;

const toMetadataRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const metadataString = (metadata: Record<string, unknown>, key: string): string | undefined =>
  typeof metadata[key] === 'string' && metadata[key].trim()
    ? metadata[key].trim()
    : undefined;

const metadataStringArray = (metadata: Record<string, unknown>, key: string): string[] => {
  const value = metadata[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const isLegislationSource = (
  source: Pick<RagKnowledgeSourceDocument, 'sourceCategory' | 'sourceType' | 'metadata'>
): boolean => {
  const metadata = toMetadataRecord(source.metadata);
  const adminCategory = metadataString(metadata, 'adminCategory');

  return (
    adminCategory === 'Legislation' ||
    source.sourceCategory === ('Legislation' as RagSourceCategory) ||
    source.sourceType === 'Act' ||
    source.sourceType === 'Regulation' ||
    Boolean(metadataString(metadata, 'constitutionalBasis')) ||
    metadataStringArray(metadata, 'legislationTags').length > 0
  );
};

const detectLegalHeading = (
  line: string
): Partial<Omit<LegislationChunkCandidate, 'text'>> | undefined => {
  const trimmed = line.trim();
  const sectionMatch =
    trimmed.match(/^(?:section|s)\.?\s+([0-9A-Za-z][0-9A-Za-z().-]*)\s*(.*)$/i) ??
    trimmed.match(/^([0-9]{1,4}[A-Za-z]?)\s+([A-Z][^\n]{3,160})$/);
  const partMatch = trimmed.match(/^part\s+([0-9A-Za-z.-]+)\s*(.*)$/i);
  const divisionMatch = trimmed.match(/^division\s+([0-9A-Za-z.-]+)\s*(.*)$/i);
  const scheduleMatch = trimmed.match(/^schedule\s+([0-9A-Za-z.-]+)\s*(.*)$/i);
  const clauseMatch = trimmed.match(/^clause\s+([0-9A-Za-z.-]+)\s*(.*)$/i);

  if (sectionMatch) {
    return {
      sectionNumber: sectionMatch[1],
      sectionHeading: sectionMatch[2]?.trim() || undefined
    };
  }

  if (partMatch) {
    return {
      part: partMatch[1],
      sectionHeading: partMatch[2]?.trim() || `Part ${partMatch[1]}`
    };
  }

  if (divisionMatch) {
    return {
      division: divisionMatch[1],
      sectionHeading: divisionMatch[2]?.trim() || `Division ${divisionMatch[1]}`
    };
  }

  if (scheduleMatch) {
    return {
      schedule: scheduleMatch[1],
      sectionHeading: scheduleMatch[2]?.trim() || `Schedule ${scheduleMatch[1]}`
    };
  }

  if (clauseMatch) {
    return {
      sectionNumber: clauseMatch[1],
      sectionHeading: clauseMatch[2]?.trim() || `Clause ${clauseMatch[1]}`
    };
  }

  return undefined;
};

const splitLongLegislationChunk = (
  chunk: LegislationChunkCandidate
): LegislationChunkCandidate[] => {
  if (chunk.text.length <= LEGISLATION_MAX_CHARS) {
    return [chunk];
  }

  const chunks: LegislationChunkCandidate[] = [];
  let cursor = 0;

  while (cursor < chunk.text.length) {
    chunks.push({
      ...chunk,
      text: chunk.text.slice(cursor, cursor + LEGISLATION_TARGET_CHARS).trim()
    });
    cursor += LEGISLATION_TARGET_CHARS - LEGISLATION_OVERLAP_CHARS;
  }

  return chunks.filter((item) => item.text.length > 0);
};

const chunkLegislationText = (text: string): LegislationChunkCandidate[] => {
  const normalized = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const lines = normalized.split('\n');
  const chunks: LegislationChunkCandidate[] = [];
  let current: LegislationChunkCandidate | null = null;
  let currentPart: string | undefined;
  let currentDivision: string | undefined;
  let currentSchedule: string | undefined;

  const flush = () => {
    if (!current?.text.trim()) {
      return;
    }

    chunks.push(...splitLongLegislationChunk({ ...current, text: current.text.trim() }));
  };

  for (const line of lines) {
    const heading = detectLegalHeading(line);

    if (heading?.part) currentPart = heading.part;
    if (heading?.division) currentDivision = heading.division;
    if (heading?.schedule) currentSchedule = heading.schedule;

    if (heading?.sectionNumber || heading?.part || heading?.division || heading?.schedule) {
      flush();
      current = {
        text: line.trim(),
        sectionNumber: heading.sectionNumber,
        sectionHeading: heading.sectionHeading,
        part: heading.part ?? currentPart,
        division: heading.division ?? currentDivision,
        schedule: heading.schedule ?? currentSchedule
      };
      continue;
    }

    if (!current) {
      current = { text: line.trim(), part: currentPart, division: currentDivision, schedule: currentSchedule };
      continue;
    }

    current.text = `${current.text}\n${line}`.trim();
  }

  flush();

  return chunks.filter((chunk) => chunk.text.length >= 80);
};

const buildKnowledgeSourceChunks = (
  source: Pick<RagKnowledgeSourceDocument, 'sourceCategory' | 'sourceType' | 'metadata'>,
  text: string
): LegislationChunkCandidate[] => {
  if (!isLegislationSource(source)) {
    return chunkText(text).map((chunk) => ({ text: chunk }));
  }

  const legislationChunks = chunkLegislationText(text);

  if (legislationChunks.length >= 2) {
    return legislationChunks;
  }

  return chunkText(text).map((chunk) => ({ text: chunk }));
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

const resolveKnowledgeSourceText = async (
  source: Pick<RagKnowledgeSourceDocument, 'rawText' | 'metadata'>,
  input: KnowledgeSourceTextInput
): Promise<{
  text: string;
  metadata?: Record<string, unknown>;
  contentType?: string;
  contentLength?: number;
}> => {
  if (input.content || input.localFilePath) {
    return { text: await readIngestionText(input) };
  }

  if (source.rawText?.trim()) {
    return { text: source.rawText };
  }

  const storedDocument = await readStoredKnowledgeDocument(source);

  if (!storedDocument) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'content or localFilePath is required when no stored extracted text or uploaded document is available'
    );
  }

  const extracted = await extractTextFromUploadedDocument(storedDocument);
  const sourceMetadata = toMetadataRecord(source.metadata);

  return {
    text: extracted.text,
    contentType: storedDocument.mimetype,
    contentLength: storedDocument.size,
    metadata: {
      uploadedFile: sourceMetadata.uploadedFile,
      extractedPageCount: extracted.pageCount,
      extractionStatus: 'extracted',
      processingStage: 'indexing',
      processingError: undefined,
      ingestionPipeline: {
        ...toMetadataRecord(sourceMetadata.ingestionPipeline),
        extractor: extracted.extractor
      }
    }
  };
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

type UploadedKnowledgeDocument = Pick<
  Express.Multer.File,
  'originalname' | 'mimetype' | 'size' | 'buffer'
>;

const getDocumentExtension = (fileName: string): string => path.extname(fileName).toLowerCase();

const isSupportedKnowledgeDocument = (file: UploadedKnowledgeDocument): boolean => {
  const extension = getDocumentExtension(file.originalname);

  return (
    KNOWLEDGE_DOCUMENT_ALLOWED_EXTENSIONS.has(extension) ||
    KNOWLEDGE_DOCUMENT_ALLOWED_MIME_TYPES.has(file.mimetype)
  );
};

const ensureSupportedKnowledgeDocument = (file: UploadedKnowledgeDocument): void => {
  if (!isSupportedKnowledgeDocument(file)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Unsupported legal document type. Upload PDF, Word, TXT, MD, HTML, CSV, or JSON.'
    );
  }

  if (file.size > KNOWLEDGE_DOCUMENT_MAX_BYTES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Knowledge document exceeds the 50MB limit.');
  }
};

const createKnowledgeDocumentStorageKey = (originalFileName: string): string => {
  const extension = getDocumentExtension(originalFileName);
  const dateSegment = new Date().toISOString().slice(0, 10);

  return `${dateSegment}/${randomUUID()}${extension}`;
};

const getKnowledgeDocumentStoragePath = (storageKey: string): string => {
  const absolutePath = path.resolve(KNOWLEDGE_DOCUMENT_STORAGE_ROOT, storageKey);

  if (!absolutePath.startsWith(KNOWLEDGE_DOCUMENT_STORAGE_ROOT)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid knowledge document storage key');
  }

  return absolutePath;
};

const saveKnowledgeDocumentFile = async (
  file: UploadedKnowledgeDocument
): Promise<string> => {
  ensureSupportedKnowledgeDocument(file);
  const storageKey = createKnowledgeDocumentStorageKey(file.originalname);
  const absolutePath = getKnowledgeDocumentStoragePath(storageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer);

  return storageKey;
};

const readStoredKnowledgeDocument = async (
  source: Pick<RagKnowledgeSourceDocument, 'metadata'>
): Promise<UploadedKnowledgeDocument | null> => {
  const sourceMetadata = toMetadataRecord(source.metadata);
  const uploadedFile = toMetadataRecord(sourceMetadata.uploadedFile);
  const storageKey = metadataString(uploadedFile, 'storageKey');

  if (!storageKey) {
    return null;
  }

  const absolutePath = getKnowledgeDocumentStoragePath(storageKey);
  const buffer = await readFile(absolutePath);

  return {
    originalname: metadataString(uploadedFile, 'originalFileName') ?? path.basename(absolutePath),
    mimetype: metadataString(uploadedFile, 'mimeType') ?? 'application/octet-stream',
    size: metadataNumber(uploadedFile, 'fileSizeBytes') ?? buffer.length,
    buffer
  };
};

const extractTextFromUploadedDocument = async (
  file: UploadedKnowledgeDocument
): Promise<{ text: string; extractor: string; pageCount?: number }> => {
  const extension = getDocumentExtension(file.originalname);
  const mimeType = file.mimetype.toLowerCase();

  if (extension === '.pdf' || mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: file.buffer });

    try {
      const parsed = await parser.getText();
      const parsedPageCount = (parsed as { total?: unknown; pages?: unknown }).total;

      return {
        text: parsed.text.trim(),
        extractor: 'pdf-parse',
        pageCount: typeof parsedPageCount === 'number' ? parsedPageCount : undefined
      };
    } finally {
      await parser.destroy();
    }
  }

  if (
    extension === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });

    return { text: parsed.value.trim(), extractor: 'mammoth' };
  }

  if (extension === '.doc' || mimeType === 'application/msword') {
    throw new ApiError(
      StatusCodes.UNPROCESSABLE_ENTITY,
      'Legacy .doc extraction is not supported. Convert the document to .docx or PDF and upload again.'
    );
  }

  const rawText = file.buffer.toString('utf8');

  if (extension === '.html' || extension === '.htm' || /html/i.test(file.mimetype)) {
    return { text: htmlToText(rawText), extractor: 'html-to-text' };
  }

  return { text: rawText.trim(), extractor: 'plain-text' };
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

const buildPineconeVectorId = (sourceId: string, chunkId: string): string =>
  `rag_source_${sourceId}_chunk_${chunkId}`;

const metadataNumber = (metadata: Record<string, unknown>, key: string): number | undefined =>
  typeof metadata[key] === 'number' && Number.isFinite(metadata[key])
    ? metadata[key]
    : undefined;

const toIdString = (value: { toString(): string } | string | undefined): string =>
  typeof value === 'string' ? value : value?.toString() ?? '';

const truncateTextForAdmin = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
};

const sanitizeKnowledgeSourceMetadataForAdmin = (
  metadata: unknown
): Record<string, unknown> => {
  const record = toMetadataRecord(metadata);
  const ingestionPipeline = toMetadataRecord(record.ingestionPipeline);

  return {
    ...record,
    processingError: truncateTextForAdmin(
      record.processingError,
      KNOWLEDGE_SOURCE_ADMIN_ERROR_PREVIEW_CHARS
    ),
    indexingError: truncateTextForAdmin(
      record.indexingError,
      KNOWLEDGE_SOURCE_ADMIN_ERROR_PREVIEW_CHARS
    ),
    ingestionPipeline:
      Object.keys(ingestionPipeline).length > 0
        ? {
            ...ingestionPipeline,
            error: truncateTextForAdmin(
              ingestionPipeline.error,
              KNOWLEDGE_SOURCE_ADMIN_ERROR_PREVIEW_CHARS
            )
          }
        : undefined
  };
};

const serializeKnowledgeSourceForAdmin = (
  source: {
    _id?: { toString(): string } | string;
    approvedAt?: unknown;
    approvedBy?: unknown;
    createdAt?: unknown;
    createdBy?: unknown;
    deletedAt?: unknown;
    description?: unknown;
    fetchedAt?: unknown;
    ingestedAt?: unknown;
    ingestionStatus?: unknown;
    jurisdiction?: unknown;
    language?: unknown;
    lastUpdated?: unknown;
    lastVerifiedAt?: unknown;
    legalReviewed?: unknown;
    legalReviewedAt?: unknown;
    legalReviewedBy?: unknown;
    licenseStatus?: unknown;
    nextRefreshAt?: unknown;
    nextReviewAt?: unknown;
    publisher?: unknown;
    rejectedAt?: unknown;
    rejectedBy?: unknown;
    rejectionReason?: unknown;
    reviewNotes?: unknown;
    rawText?: string;
    sha256Hash?: unknown;
    sourceCategory?: unknown;
    sourceType?: unknown;
    status?: unknown;
    title?: unknown;
    topic?: unknown;
    updatedAt?: unknown;
    url?: unknown;
    version?: unknown;
    metadata?: unknown;
    ingestionError?: string;
    localFilePath?: string;
  }
): Record<string, unknown> => {
  const { _id, rawText, metadata, ingestionError, ...rest } = source;
  const id = toIdString(_id);
  const sanitizedMetadata = sanitizeKnowledgeSourceMetadataForAdmin(metadata);
  const uploadedFileMetadata = toMetadataRecord(sanitizedMetadata.uploadedFile);

  return decorateSourceReadiness({
    ...rest,
    _id: id,
    id,
    ingestionError: truncateTextForAdmin(
      ingestionError,
      KNOWLEDGE_SOURCE_ADMIN_ERROR_PREVIEW_CHARS
    ),
    rawTextPreview:
      typeof rawText === 'string' && rawText.trim()
        ? rawText.slice(0, KNOWLEDGE_SOURCE_ADMIN_TEXT_PREVIEW_CHARS)
        : undefined,
    rawTextLength: typeof rawText === 'string' ? rawText.length : 0,
    hasStoredContent: Boolean(
      (typeof rawText === 'string' && rawText.trim()) ||
        (typeof rest.localFilePath === 'string' && rest.localFilePath.trim()) ||
        metadataString(uploadedFileMetadata, 'storageKey')
    ),
    metadata: sanitizedMetadata
  });
};

const chunkArray = <T>(items: readonly T[], size: number): T[][] => {
  if (items.length === 0) {
    return [];
  }

  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
};

const buildEmbeddingBatches = <T extends { text: string }>(items: readonly T[]): T[][] => {
  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentEstimatedTokens = 0;

  for (const item of items) {
    const estimatedTokens = Math.max(1, Math.ceil(item.text.length / 4));
    const exceedsChunkLimit = currentBatch.length >= EMBEDDING_BATCH_MAX_CHUNKS;
    const exceedsTokenLimit =
      currentBatch.length > 0 &&
      currentEstimatedTokens + estimatedTokens > EMBEDDING_BATCH_MAX_ESTIMATED_TOKENS;

    if (exceedsChunkLimit || exceedsTokenLimit) {
      batches.push(currentBatch);
      currentBatch = [];
      currentEstimatedTokens = 0;
    }

    currentBatch.push(item);
    currentEstimatedTokens += estimatedTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
};

const formatBatchFailureMessage = (
  operation: string,
  batchNumber: number,
  totalBatches: number,
  attempts: number,
  error: unknown
): string => {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return `${operation} batch ${batchNumber}/${totalBatches} failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${errorMessage}`;
};

const runBatchWithRetry = async <T>(
  operation: string,
  batchNumber: number,
  totalBatches: number,
  action: () => Promise<T>
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;

      logger.warn(
        {
          error,
          operation,
          batchNumber,
          totalBatches,
          attempt,
          maxAttempts: MAX_BATCH_ATTEMPTS
        },
        'Knowledge source batch operation failed'
      );
    }
  }

  throw new Error(
    formatBatchFailureMessage(
      operation,
      batchNumber,
      totalBatches,
      MAX_BATCH_ATTEMPTS,
      lastError
    )
  );
};

const buildVectorMetadata = (
  source: RagKnowledgeSourceDocument,
  chunk: Pick<
    RagChunkDocument,
    '_id' | 'sourceId' | 'sectionRef' | 'chunkIndex' | 'metadata'
  >
): Record<string, unknown> => {
  const sourceMetadata = toMetadataRecord(source.metadata);
  const chunkMetadata = toMetadataRecord(chunk.metadata);

  return {
    chunkId: chunk._id.toString(),
    sourceId: chunk.sourceId.toString(),
    title: source.title,
    sourceCategory: source.sourceCategory,
    adminCategory: metadataString(sourceMetadata, 'adminCategory'),
    jurisdiction: source.jurisdiction,
    topic: source.topic,
    sourceType: source.sourceType,
    status: source.status,
    legalReviewed: source.legalReviewed,
    actName:
      metadataString(chunkMetadata, 'actName') ??
      metadataString(sourceMetadata, 'actName') ??
      metadataStringArray(sourceMetadata, 'detectedActNames')[0],
    sectionNumber:
      metadataString(chunkMetadata, 'sectionNumber') ??
      metadataString(chunkMetadata, 'sectionRef') ??
      chunk.sectionRef,
    sectionHeading: metadataString(chunkMetadata, 'sectionHeading'),
    constitutionalBasis:
      metadataString(chunkMetadata, 'constitutionalBasis') ??
      metadataString(sourceMetadata, 'constitutionalBasis'),
    legislationTags:
      metadataStringArray(chunkMetadata, 'legislationTags').length > 0
        ? metadataStringArray(chunkMetadata, 'legislationTags')
        : metadataStringArray(sourceMetadata, 'legislationTags'),
    language: source.language,
    version: source.version,
    pageStart: metadataNumber(chunkMetadata, 'pageStart'),
    pageEnd: metadataNumber(chunkMetadata, 'pageEnd'),
    chunkIndex: chunk.chunkIndex
  };
};

type PineconeIndexableChunk = Pick<
  RagChunkDocument,
  '_id' | 'sourceId' | 'sectionRef' | 'chunkIndex' | 'metadata' | 'embedding'
>;

type EmbeddedKnowledgeSourceChunk = Omit<RagChunkDocument, '_id' | 'createdAt' | 'updatedAt'>;

const persistSourceIndexingProgress = async (
  source: HydratedRagKnowledgeSourceDocument,
  chunkCount: number,
  indexedChunkCount: number,
  update: {
    indexedAt?: string;
    indexingError?: string;
  } = {}
): Promise<void> => {
  const sourceMetadata = toMetadataRecord(source.metadata);
  const ingestionPipeline = toMetadataRecord(sourceMetadata.ingestionPipeline);
  const partiallyIndexed = Boolean(update.indexingError && indexedChunkCount > 0);

  await RagKnowledgeSourceModel.updateOne(
    { _id: source._id },
    {
      $set: {
        'metadata.chunkCount': chunkCount,
        'metadata.indexedChunkCount': indexedChunkCount,
        'metadata.pineconeIndexedAt': update.indexedAt,
        'metadata.pineconeNamespace': getPineconeNamespace(),
        'metadata.pineconeIndexName': getPineconeIndexName(),
        'metadata.indexingError': update.indexingError,
        'metadata.processingError': update.indexingError,
        'metadata.processingStage': update.indexingError
          ? partiallyIndexed
            ? 'partial_index_failed'
            : 'indexing_failed'
          : 'indexing',
        'metadata.searchReadinessStatus': update.indexingError ? 'failed' : 'indexing',
        'metadata.ingestionPipeline': {
          ...ingestionPipeline,
          status: update.indexingError
            ? partiallyIndexed
              ? 'partial_index_failed'
              : 'failed'
            : 'indexing',
          updatedAt: new Date().toISOString(),
          extractor: metadataString(ingestionPipeline, 'extractor'),
          error: update.indexingError
        }
      }
    }
  );
};

const upsertChunksToPinecone = async (
  source: HydratedRagKnowledgeSourceDocument,
  chunks: PineconeIndexableChunk[]
): Promise<{ indexedChunkCount: number; indexedAt?: string; indexingError?: string }> => {
  if (!isPineconeConfigured()) {
    logger.info({ sourceId: source._id.toString() }, 'Pinecone disabled; keeping Mongo RAG index only');

    return { indexedChunkCount: 0 };
  }

  const chunkBatches = chunkArray(chunks, PINECONE_UPSERT_BATCH_SIZE);
  let indexedChunkCount = 0;
  let indexedAt: string | undefined;

  for (const [batchIndex, batch] of chunkBatches.entries()) {
    const batchNumber = batchIndex + 1;
    const batchIndexedAt = new Date().toISOString();
    const vectorBatch = batch.map((chunk) => {
      const vectorId = buildPineconeVectorId(source._id.toString(), chunk._id.toString());

      return {
        id: vectorId,
        values: chunk.embedding,
        metadata: {
          ...buildVectorMetadata(source, chunk),
          pineconeVectorId: vectorId
        }
      };
    });

    try {
      await runBatchWithRetry('Pinecone upsert', batchNumber, chunkBatches.length, async () =>
        pineconeVectorStore.upsertChunks({ chunks: vectorBatch })
      );
    } catch (error) {
      const indexingError =
        error instanceof Error ? error.message : 'Pinecone indexing failed';

      await RagChunkModel.updateMany(
        { _id: { $in: batch.map((chunk) => chunk._id) } },
        {
          $set: {
            'metadata.embeddingStatus': 'failed',
            'metadata.embeddingError': indexingError
          }
        }
      );

      await persistSourceIndexingProgress(source, chunks.length, indexedChunkCount, {
        indexedAt,
        indexingError
      });

      logger.error(
        {
          error,
          sourceId: source._id.toString(),
          batchNumber,
          totalBatches: chunkBatches.length,
          indexName: getPineconeIndexName()
        },
        'Pinecone indexing failed'
      );

      return { indexedChunkCount, indexedAt, indexingError };
    }

    await RagChunkModel.bulkWrite(
      batch.map((chunk) => ({
        updateOne: {
          filter: { _id: chunk._id },
          update: {
            $set: {
              'metadata.pineconeVectorId': buildPineconeVectorId(
                source._id.toString(),
                chunk._id.toString()
              ),
              'metadata.pineconeIndexedAt': batchIndexedAt,
              'metadata.embeddingStatus': 'indexed',
              'metadata.embeddingError': undefined
            }
          }
        }
      }))
    );

    indexedChunkCount += batch.length;
    indexedAt = batchIndexedAt;

    await persistSourceIndexingProgress(source, chunks.length, indexedChunkCount, {
      indexedAt
    });
  }

  return { indexedChunkCount, indexedAt };
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
  const chunks = buildKnowledgeSourceChunks(source, text);
  const extractedLegalMetadata = extractLegalMetadataFromText(text, source);
  const baseMetadata = {
    ...toMetadataRecord(source.metadata),
    ...toMetadataRecord(options.metadata),
    ...extractedLegalMetadata
  };
  const extractedPageCount = metadataNumber(baseMetadata, 'extractedPageCount');
  const largeDocumentWarning =
    (typeof extractedPageCount === 'number' &&
      extractedPageCount > LARGE_DOCUMENT_PAGE_WARNING_THRESHOLD) ||
    chunks.length > LARGE_DOCUMENT_CHUNK_WARNING_THRESHOLD
      ? `Large document detected. SafeSpeak will ingest this source in batches (${EMBEDDING_BATCH_MAX_CHUNKS} embeddings, ${PINECONE_UPSERT_BATCH_SIZE} Pinecone vectors, ${MONGO_CHUNK_WRITE_BATCH_SIZE} Mongo chunk writes).`
      : undefined;

  source.ingestionStatus = 'chunked';
  source.metadata = withSearchReadiness(
    {
      ...baseMetadata,
      chunkCount: chunks.length,
      indexedChunkCount: 0,
      processingStage: 'indexing',
      processingError: undefined,
      indexingError: undefined,
      largeDocumentWarning,
      ingestionPipeline: {
        ...toMetadataRecord(baseMetadata.ingestionPipeline),
        status: 'indexing',
        updatedAt: new Date().toISOString(),
        extractor: metadataString(toMetadataRecord(baseMetadata.ingestionPipeline), 'extractor'),
        error: undefined
      }
    },
    'indexing'
  );
  await source.save();

  const sourceMetadata = {
    ...toMetadataRecord(source.metadata),
    ...toMetadataRecord(options.metadata),
    ...extractedLegalMetadata
  };
  const chunkDescriptors = chunks.map((chunk, index) => {
    const sectionRef = chunk.sectionNumber
      ? `Section ${chunk.sectionNumber}`
      : chunk.part
        ? `Part ${chunk.part}`
        : chunk.division
          ? `Division ${chunk.division}`
          : chunk.schedule
            ? `Schedule ${chunk.schedule}`
            : undefined;

    return {
      ...chunk,
      index,
      sectionRef,
      tokenCount: Math.ceil(chunk.text.length / 4),
      citationLabel: sectionRef
        ? `${source.title}, ${sectionRef}${chunk.sectionHeading ? ` - ${chunk.sectionHeading}` : ''}`
        : `${source.title} [chunk ${index + 1}]`
    };
  });
  const embeddingBatches = buildEmbeddingBatches(chunkDescriptors);
  const embeddedChunks: EmbeddedKnowledgeSourceChunk[] = [];

  for (const [batchIndex, batch] of embeddingBatches.entries()) {
    const embeddings = await runBatchWithRetry(
      'OpenAI embedding',
      batchIndex + 1,
      embeddingBatches.length,
      async () => createEmbeddings(batch.map((item) => item.text))
    );

    batch.forEach((chunk, index) => {
      embeddedChunks.push({
        sourceId: source._id,
        sourceCategory: source.sourceCategory,
        jurisdiction: source.jurisdiction,
        topic: source.topic,
        sectionRef: chunk.sectionRef,
        chunkIndex: chunk.index,
        chunkText: chunk.text,
        embedding: embeddings[index],
        tokenCount: chunk.tokenCount,
        citationLabel: chunk.citationLabel,
        citationUrl: source.url,
        metadata: {
          ...sourceMetadata,
          sourceTitle: source.title,
          sourceType: source.sourceType,
          sourceCategory: source.sourceCategory,
          language: source.language,
          jurisdiction: source.jurisdiction,
          legalSourceType: source.sourceType,
          actName:
            metadataString(sourceMetadata, 'actName') ??
            metadataStringArray(sourceMetadata, 'detectedActNames')[0],
          sectionNumber: chunk.sectionNumber,
          sectionHeading: chunk.sectionHeading,
          part: chunk.part,
          division: chunk.division,
          schedule: chunk.schedule,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          constitutionalBasis: metadataString(sourceMetadata, 'constitutionalBasis'),
          legislationTags: metadataStringArray(sourceMetadata, 'legislationTags'),
          embeddingStatus: isPineconeConfigured() ? ('pending' as const) : ('indexed' as const)
        }
      });
    });
  }

  if (embeddedChunks.length > 0) {
    for (const mongoBatch of chunkArray(embeddedChunks, MONGO_CHUNK_WRITE_BATCH_SIZE)) {
      await RagChunkModel.bulkWrite(
        mongoBatch.map((chunk) => ({
          updateOne: {
            filter: {
              sourceId: chunk.sourceId,
              chunkIndex: chunk.chunkIndex
            },
            update: {
              $set: chunk
            },
            upsert: true
          }
        }))
      );
    }
  }

  await RagChunkModel.deleteMany({
    sourceId: source._id,
    chunkIndex: { $gte: embeddedChunks.length }
  });

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
  source.version = (source.version ?? 1) + (hashChanged ? 1 : 0);

  if (isPineconeConfigured()) {
    await pineconeVectorStore.deleteBySource(source._id.toString());
  }

  const savedChunks = await RagChunkModel.find({ sourceId: source._id }).sort({ chunkIndex: 1 });
  const pineconeIndexing = await upsertChunksToPinecone(source, savedChunks);
  const indexingFailed = Boolean(pineconeIndexing.indexingError);
  const partiallyIndexed = indexingFailed && pineconeIndexing.indexedChunkCount > 0;
  const searchableAt = indexingFailed ? undefined : getSearchableAt(verificationDate);
  source.ingestionStatus = partiallyIndexed
    ? 'partial_index_failed'
    : indexingFailed
      ? 'failed'
      : 'embedded';
  source.ingestionError = pineconeIndexing.indexingError;

  source.metadata = withSearchReadiness(
    {
      ...source.metadata,
      ...options.metadata,
      ...extractedLegalMetadata,
      chunkCount: embeddedChunks.length,
      indexedChunkCount: isPineconeConfigured()
        ? pineconeIndexing.indexedChunkCount
        : embeddedChunks.length,
      pineconeIndexedAt: pineconeIndexing.indexedAt,
      pineconeNamespace: isPineconeConfigured() ? getPineconeNamespace() : undefined,
      pineconeIndexName: isPineconeConfigured() ? getPineconeIndexName() : undefined,
      indexingError: pineconeIndexing.indexingError,
      extractionStatus: 'extracted',
      processingStage: indexingFailed
        ? partiallyIndexed
          ? 'partial_index_failed'
          : 'indexing_failed'
        : 'indexed',
      processingError: pineconeIndexing.indexingError,
      ingestionPipeline: {
        ...toMetadataRecord(sourceMetadata.ingestionPipeline),
        status: indexingFailed
          ? partiallyIndexed
            ? 'partial_index_failed'
            : 'failed'
          : 'indexed',
        updatedAt: verificationDate.toISOString(),
        extractor: metadataString(
          toMetadataRecord(sourceMetadata.ingestionPipeline),
          'extractor'
        ),
        error: pineconeIndexing.indexingError
      },
      sha256Verified: true,
      contentHashChanged: hashChanged,
      refreshMode: options.refreshMode,
      contentType: options.contentType,
      contentLength: options.contentLength,
      lastVerifiedAt: verificationDate.toISOString()
    },
    indexingFailed ? 'failed' : 'indexed_pending_search',
    searchableAt
  );
  await source.save();

  return {
    chunkCount: embeddedChunks.length,
    sha256Hash,
    extractedLegalMetadata,
    hashChanged
  };
};

export const listKnowledgeSources = async (): Promise<unknown[]> =>
  (await RagKnowledgeSourceModel.find({ deletedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .lean()).map((source) => serializeKnowledgeSourceForAdmin(source as Record<string, unknown>));

const addReadinessBlocker = (
  blockers: Map<ReadinessBlockerCode, RagKnowledgeReadinessBlocker>,
  code: ReadinessBlockerCode,
  source: Pick<RagKnowledgeSourceDocument, '_id' | 'title'>
): void => {
  const existing = blockers.get(code) ?? {
    code,
    label: READINESS_BLOCKER_LABELS[code],
    count: 0,
    sourceIds: [],
    sourceTitles: []
  };

  existing.count += 1;
  existing.sourceIds.push(source._id.toString());
  existing.sourceTitles.push(source.title);
  blockers.set(code, existing);
};

const addGlobalReadinessBlocker = (
  blockers: Map<ReadinessBlockerCode, RagKnowledgeReadinessBlocker>,
  code: ReadinessBlockerCode
): void => {
  const existing = blockers.get(code) ?? {
    code,
    label: READINESS_BLOCKER_LABELS[code],
    count: 0,
    sourceIds: [],
    sourceTitles: []
  };

  existing.count += 1;
  blockers.set(code, existing);
};

const getVectorIndexErrorMessage = (error: unknown): string => {
  const errorLike = error as {
    codeName?: string;
    message?: string;
    errorResponse?: { codeName?: string; errmsg?: string };
  };

  return (
    errorLike?.message ??
    errorLike?.errorResponse?.errmsg ??
    errorLike?.codeName ??
    errorLike?.errorResponse?.codeName ??
    String(error)
  );
};

const getVectorIndexErrorCodeName = (error: unknown): string => {
  const errorLike = error as {
    codeName?: string;
    errorResponse?: { codeName?: string };
  };

  return errorLike?.codeName ?? errorLike?.errorResponse?.codeName ?? '';
};

export const checkRagVectorIndexReadiness = async (): Promise<RagVectorIndexReadiness> => {
  const expectedDimensions = EMBEDDING_DIMENSIONS[env.OPENAI_EMBEDDING_MODEL];
  const base = {
    indexName: env.RAG_VECTOR_INDEX,
    collectionName: RagChunkModel.collection.name,
    embeddingField: 'embedding' as const,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    expectedDimensions
  };

  try {
    const pipeline = [{ $listSearchIndexes: {} }] as unknown as PipelineStage[];
    type SearchIndexResult = { name?: string; latestDefinition?: unknown };
    const indexes = await RagChunkModel.aggregate<SearchIndexResult>(pipeline);
    const target = indexes.find((index) => index.name === env.RAG_VECTOR_INDEX);

    if (!target) {
      return {
        ...base,
        status: 'missing',
        message:
          'RAG vector index is missing. Create the Atlas Search index before retrieval tests.'
      };
    }

    return {
      ...base,
      status: 'ready',
      definition: target.latestDefinition ?? null,
      message: 'RAG vector index is available.'
    };
  } catch (error) {
    const message = getVectorIndexErrorMessage(error);
    const codeName = getVectorIndexErrorCodeName(error);

    if (/SearchNotEnabled/i.test(`${codeName} ${message}`)) {
      return {
        ...base,
        status: 'unavailable',
        message:
          'Atlas Search / Vector Search is not enabled on this Mongo deployment. Enable Atlas Search and create the configured vector index.'
      };
    }

    if (/index .*not found|index not found|does not exist/i.test(message)) {
      return {
        ...base,
        status: 'missing',
        message:
          'RAG vector index is missing. Create the Atlas Search index before retrieval tests.'
      };
    }

    return {
      ...base,
      status: 'error',
      message: `Vector index readiness check failed: ${message}`
    };
  }
};

const getCoverageKey = (
  sourceCategory: GovernedRagSourceCategory,
  jurisdiction: RagJurisdiction,
  topic: RagTopic
): string => `${sourceCategory}:${jurisdiction}:${topic}`;

const createCoverageCell = (
  sourceCategory: GovernedRagSourceCategory,
  jurisdiction: RagJurisdiction,
  topic: RagTopic
): RagKnowledgeReadinessCoverageCell => ({
  sourceCategory,
  jurisdiction,
  topic,
  totalSources: 0,
  eligibleSources: 0,
  approvedSources: 0,
  pendingReviewSources: 0,
  needsLegalReviewSources: 0,
  needsRefreshSources: 0,
  metadataOnlySources: 0,
  failedIngestionSources: 0,
  noChunkSources: 0
});

export const getKnowledgeSourceReadiness = async (
  context: RagServiceContext
): Promise<RagKnowledgeSourceReadiness> => {
  ownerFilter(context.owner);

  const now = new Date();
  const [sources, vectorIndex] = await Promise.all([
    RagKnowledgeSourceModel.find({
      deletedAt: { $exists: false },
      sourceCategory: { $in: RAG_GOVERNED_SOURCE_CATEGORIES }
    })
      .select(
        '_id title sourceCategory jurisdiction topic url status ingestionStatus nextRefreshAt legalReviewed'
      )
      .lean(),
    checkRagVectorIndexReadiness()
  ]);
  const openAiApiKeyConfigured = Boolean(env.OPENAI_API_KEY);
  const retrievalConfigurationReady = openAiApiKeyConfigured && vectorIndex.status === 'ready';
  const sourceIds = sources.map((source) => source._id);
  const chunkRows =
    sourceIds.length > 0
      ? await RagChunkModel.aggregate<{ _id: RagKnowledgeSourceDocument['_id']; count: number }>([
          { $match: { sourceId: { $in: sourceIds } } },
          { $group: { _id: '$sourceId', count: { $sum: 1 } } }
        ])
      : [];
  const chunkCountBySourceId = new Map(
    chunkRows.map((row) => [row._id.toString(), row.count])
  );
  const coverage = new Map<string, RagKnowledgeReadinessCoverageCell>();
  const blockers = new Map<ReadinessBlockerCode, RagKnowledgeReadinessBlocker>();
  const summary = {
    readinessStatus: 'not_ready' as const,
    readyForPublicLegalRag: false,
    retrievalConfigurationReady,
    totalOfficialSources: sources.length,
    eligibleCitationSources: 0,
    eligibleLegalSources: 0,
    approvedCurrentSources: 0,
    legalReviewedSources: 0,
    pendingReviewSources: 0,
    expiredRefreshSources: 0,
    metadataOnlySources: 0,
    failedIngestionSources: 0,
    blockedSources: 0
  };

  if (!openAiApiKeyConfigured) {
    addGlobalReadinessBlocker(blockers, 'openai_api_key_missing');
  }

  if (vectorIndex.status === 'missing') {
    addGlobalReadinessBlocker(blockers, 'vector_index_missing');
  } else if (vectorIndex.status === 'unavailable') {
    addGlobalReadinessBlocker(blockers, 'vector_search_unavailable');
  } else if (vectorIndex.status === 'error') {
    addGlobalReadinessBlocker(blockers, 'vector_index_check_failed');
  }

  for (const source of sources) {
    if (!isGovernedSourceCategory(source.sourceCategory)) {
      continue;
    }

    const chunkCount = chunkCountBySourceId.get(source._id.toString()) ?? 0;
    const hasApprovedOfficialUrl = Boolean(source.url && isOfficialSourceUrl(source.url));
    const hasCurrentRefresh = Boolean(
      source.nextRefreshAt && source.nextRefreshAt.getTime() > now.getTime()
    );
    const isApproved = source.status === 'approved';
    const hasLegalReview =
      source.sourceCategory !== 'official_legal_source' || source.legalReviewed;
    const isEmbedded = source.ingestionStatus === 'embedded';
    const hasChunks = chunkCount > 0;
    const isEligible =
      isApproved &&
      hasApprovedOfficialUrl &&
      hasCurrentRefresh &&
      hasLegalReview &&
      isEmbedded &&
      hasChunks;
    const sourceBlockers: ReadinessBlockerCode[] = [];

    if (!isApproved) {
      sourceBlockers.push('not_approved');
      summary.pendingReviewSources += source.status === 'pending_review' ? 1 : 0;
    }

    if (!hasApprovedOfficialUrl) {
      sourceBlockers.push('official_url_missing_or_unapproved');
    }

    if (!hasCurrentRefresh) {
      sourceBlockers.push('refresh_due_or_missing');
      summary.expiredRefreshSources += 1;
    }

    if (source.sourceCategory === 'official_legal_source') {
      if (source.legalReviewed) {
        summary.legalReviewedSources += 1;
      } else {
        sourceBlockers.push('legal_review_missing');
      }
    }

    if (source.ingestionStatus === 'metadata_only') {
      sourceBlockers.push('metadata_only_needs_text');
      summary.metadataOnlySources += 1;
    } else if (source.ingestionStatus === 'failed') {
      sourceBlockers.push('ingestion_failed');
      summary.failedIngestionSources += 1;
    } else if (!isEmbedded) {
      sourceBlockers.push('not_embedded');
    }

    if (!hasChunks) {
      sourceBlockers.push('no_chunks');
    }

    if (isApproved && hasCurrentRefresh) {
      summary.approvedCurrentSources += 1;
    }

    if (isEligible) {
      summary.eligibleCitationSources += 1;
      if (source.sourceCategory === 'official_legal_source') {
        summary.eligibleLegalSources += 1;
      }
    }

    if (sourceBlockers.length > 0) {
      summary.blockedSources += 1;
      sourceBlockers.forEach((code) => addReadinessBlocker(blockers, code, source));
    }

    const coverageKey = getCoverageKey(source.sourceCategory, source.jurisdiction, source.topic);
    const cell =
      coverage.get(coverageKey) ??
      createCoverageCell(source.sourceCategory, source.jurisdiction, source.topic);

    cell.totalSources += 1;
    cell.eligibleSources += isEligible ? 1 : 0;
    cell.approvedSources += isApproved ? 1 : 0;
    cell.pendingReviewSources += isApproved ? 0 : 1;
    cell.needsLegalReviewSources +=
      source.sourceCategory === 'official_legal_source' && !source.legalReviewed ? 1 : 0;
    cell.needsRefreshSources += hasCurrentRefresh ? 0 : 1;
    cell.metadataOnlySources += source.ingestionStatus === 'metadata_only' ? 1 : 0;
    cell.failedIngestionSources += source.ingestionStatus === 'failed' ? 1 : 0;
    cell.noChunkSources += hasChunks ? 0 : 1;
    coverage.set(coverageKey, cell);
  }

  summary.readyForPublicLegalRag =
    summary.eligibleLegalSources > 0 && retrievalConfigurationReady;
  const readinessStatus = summary.readyForPublicLegalRag
    ? summary.blockedSources > 0
      ? 'ready_with_gaps'
      : 'ready'
    : 'not_ready';

  await auditRagAction(context, RAG_ACTIONS.sourceReadiness, undefined, {
    readyForPublicLegalRag: summary.readyForPublicLegalRag,
    eligibleLegalSources: summary.eligibleLegalSources,
    blockedSources: summary.blockedSources,
    retrievalConfigurationReady,
    vectorIndexStatus: vectorIndex.status,
    openAiApiKeyConfigured
  });

  return {
    generatedAt: now.toISOString(),
    summary: {
      ...summary,
      readinessStatus
    },
    configuration: {
      openAiApiKeyConfigured,
      embeddingModel: env.OPENAI_EMBEDDING_MODEL,
      vectorIndex,
      retrievalReady: retrievalConfigurationReady
    },
    coverage: Array.from(coverage.values()).sort((a, b) =>
      `${a.sourceCategory}:${a.jurisdiction}:${a.topic}`.localeCompare(
        `${b.sourceCategory}:${b.jurisdiction}:${b.topic}`
      )
    ),
    blockers: Array.from(blockers.values()).sort((a, b) => b.count - a.count)
  };
};

export const listKnowledgeSourceChunks = async (
  context: RagServiceContext,
  sourceId: string,
  query: KnowledgeSourceChunkQueryInput
): Promise<Record<string, unknown>> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(
    KNOWLEDGE_SOURCE_CHUNK_PREVIEW_MAX_LIMIT,
    Math.max(1, query.limit ?? KNOWLEDGE_SOURCE_CHUNK_PREVIEW_DEFAULT_LIMIT)
  );
  const skip = (page - 1) * limit;

  const [chunks, totalCount] = await Promise.all([
    RagChunkModel.find({ sourceId: source._id })
      .sort({ chunkIndex: 1 })
      .skip(skip)
      .limit(limit)
      .select(
        'chunkIndex chunkText tokenCount citationLabel citationUrl sectionRef metadata createdAt updatedAt'
      )
      .lean(),
    RagChunkModel.countDocuments({ sourceId: source._id })
  ]);
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / limit) : 0;

  await auditRagAction(context, RAG_ACTIONS.search, source._id.toString(), {
    mode: 'admin_chunk_preview',
    chunkCount: chunks.length,
    totalCount,
    page,
    limit
  });

  return {
    page,
    limit,
    totalCount,
    totalPages,
    chunks: chunks.map((chunk) => ({
      id: chunk._id.toString(),
      chunkIndex: chunk.chunkIndex,
      text: chunk.chunkText,
      tokenCount: chunk.tokenCount,
      citationLabel: chunk.citationLabel,
      citationUrl: chunk.citationUrl,
      sectionRef: chunk.sectionRef,
      metadata: chunk.metadata,
      createdAt: chunk.createdAt,
      updatedAt: chunk.updatedAt
    }))
  };
};

export const getPineconeHealth = async (
  context: RagServiceContext
): Promise<Record<string, unknown>> => {
  ownerFilter(context.owner);
  const health = await pineconeVectorStore.healthCheck();

  await auditRagAction(context, RAG_ACTIONS.sourceReadiness, undefined, {
    mode: 'pinecone_health',
    configured: health.configured,
    reachable: health.reachable ?? health.healthy
  });

  return {
    configured: health.configured,
    indexName: health.indexName ?? getPineconeIndexName(),
    namespace: health.namespace ?? getPineconeNamespace(),
    embeddingModel: health.embeddingModel ?? env.OPENAI_EMBEDDING_MODEL,
    expectedDimension: health.expectedDimension ?? getExpectedEmbeddingDimension(),
    reachable: health.reachable ?? health.healthy,
    error: health.healthy ? undefined : health.message
  };
};

export const createKnowledgeSource = async (
  context: RagServiceContext,
  input: CreateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const normalizedInput = normalizeKnowledgeSourceInput(input);

  if (normalizedInput.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Knowledge sources must be approved through the review workflow'
    );
  }

  assertKnowledgeSourceGovernance(normalizedInput);

  const source = await RagKnowledgeSourceModel.create({
    ...normalizedInput,
    createdBy: context.owner.userId,
    legalReviewedBy: normalizedInput.legalReviewed ? context.owner.userId : undefined,
    legalReviewedAt: normalizedInput.legalReviewed ? new Date() : undefined,
    lastVerifiedAt: normalizedInput.lastVerifiedAt ?? new Date()
  });

  await auditRagAction(context, RAG_ACTIONS.sourceCreate, source._id.toString(), {
    sourceType: source.sourceType,
    sourceCategory: source.sourceCategory
  });

  return serializeKnowledgeSourceForAdmin(source.toObject());
};

export const updateKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: UpdateKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const normalizedInput = normalizeKnowledgeSourceInput(input);

  if (normalizedInput.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Use the approval endpoint to approve a knowledge source'
    );
  }

  const source = await getSource(sourceId);
  assertMergedKnowledgeSourceGovernance(source, normalizedInput);

  const shouldReturnToReview =
    source.status === 'approved' &&
    hasMaterialReviewChange(normalizedInput) &&
    normalizedInput.status === undefined;
  const legalReviewedChanged =
    normalizedInput.legalReviewed !== undefined &&
    normalizedInput.legalReviewed !== source.legalReviewed;

  source.set(normalizedInput);

  if (legalReviewedChanged) {
    source.legalReviewedBy = normalizedInput.legalReviewed
      ? (context.owner.userId as never)
      : undefined;
    source.legalReviewedAt = normalizedInput.legalReviewed ? new Date() : undefined;
  }

  if (hasMaterialReviewChange(normalizedInput)) {
    source.lastVerifiedAt = normalizedInput.lastVerifiedAt ?? new Date();
  }

  if (shouldReturnToReview) {
    clearApprovalState(source);
  }

  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceUpdate, source._id.toString(), {
    changedFields: Object.keys(normalizedInput),
    returnedToReview: shouldReturnToReview
  });

  return serializeKnowledgeSourceForAdmin(source.toObject());
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

  if (isPineconeConfigured()) {
    try {
      await pineconeVectorStore.deleteBySource(source._id.toString());
    } catch (error) {
      const indexingError = error instanceof Error ? error.message : 'Pinecone source delete failed';
      source.metadata = {
        ...source.metadata,
        indexingError,
        processingStage: 'vector_delete_failed',
        processingError: indexingError
      };
      await source.save();
      throw new ApiError(StatusCodes.BAD_GATEWAY, 'Pinecone vectors could not be deleted');
    }
  }

  await RagChunkModel.deleteMany({ sourceId: source._id });

  await auditRagAction(context, RAG_ACTIONS.sourceDelete, source._id.toString());
};

export const uploadKnowledgeSourceDocument = async (
  context: RagServiceContext,
  sourceId: string,
  file: UploadedKnowledgeDocument | undefined,
  options: { ingestImmediately?: boolean } = {}
): Promise<unknown> => {
  ownerFilter(context.owner);

  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Legal source document file is required');
  }

  const source = await getSource(sourceId);
  assertMergedKnowledgeSourceGovernance(source, {});

  const storageKey = await saveKnowledgeDocumentFile(file);
  const uploadedAt = new Date();
  const documentMetadata = {
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    fileSizeBytes: file.size,
    storageKey,
    uploadedAt: uploadedAt.toISOString()
  };

  source.metadata = withSearchReadiness(
    {
      ...toMetadataRecord(source.metadata),
      uploadedFile: documentMetadata,
      indexedChunkCount: 0,
      processingStage: options.ingestImmediately === false ? 'not_indexed' : 'extracting',
      processingError: undefined,
      indexingError: undefined,
      ingestionPipeline: {
        status: options.ingestImmediately === false ? 'needs_review' : 'extracting',
        updatedAt: uploadedAt.toISOString()
      }
    },
    options.ingestImmediately === false ? 'not_indexed' : 'indexing'
  );
  source.ingestionStatus = options.ingestImmediately === false ? 'metadata_only' : 'fetched';
  source.ingestionError = undefined;
  source.fetchedAt = uploadedAt;
  await source.save();

  if (options.ingestImmediately === false) {
    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      mode: 'admin_document_upload',
      fileName: file.originalname,
      fileSizeBytes: file.size,
      status: 'uploaded_needs_review'
    });

    return {
      source: serializeKnowledgeSourceForAdmin(source.toObject()),
      uploadedFile: documentMetadata,
      ingestionStatus: source.ingestionStatus,
      message: 'Document uploaded. Run ingestion after review.'
    };
  }

  try {
    const extracted = await extractTextFromUploadedDocument(file);

    if (extracted.text.length < OFFICIAL_REFRESH_MIN_TEXT_LENGTH) {
      throw new ApiError(
        StatusCodes.UNPROCESSABLE_ENTITY,
        'Extracted document text was too short to index safely. The PDF may be scanned or image-only; OCR is not supported yet.'
      );
    }

    const result = await embedKnowledgeSourceText(source, extracted.text, {
      metadata: {
        uploadedFile: documentMetadata,
        extractedPageCount: extracted.pageCount,
        extractionStatus: 'extracted',
        processingStage: 'indexing',
        processingError: undefined,
        ingestionPipeline: {
          status: 'indexed',
          extractor: extracted.extractor,
          updatedAt: new Date().toISOString()
        }
      },
      refreshMode: 'admin_document_upload',
      contentType: file.mimetype,
      contentLength: file.size
    });

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      mode: 'admin_document_upload',
      fileName: file.originalname,
      fileSizeBytes: file.size,
      extractor: extracted.extractor,
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      requiresHumanReview: source.status !== 'approved'
    });

    return {
      source: serializeKnowledgeSourceForAdmin(source.toObject()),
      uploadedFile: documentMetadata,
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      extractedLegalMetadata: result.extractedLegalMetadata,
      ingestionStatus: source.ingestionStatus
    };
  } catch (error) {
    source.ingestionStatus = 'failed';
    source.ingestionError =
      error instanceof Error ? error.message : 'Document extraction failed';
    source.metadata = withSearchReadiness({
      ...toMetadataRecord(source.metadata),
      uploadedFile: documentMetadata,
      extractionStatus: 'failed',
      processingStage: 'failed',
      processingError: source.ingestionError,
      ingestionPipeline: {
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: source.ingestionError
      }
    }, 'failed');
    await source.save();

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      mode: 'admin_document_upload',
      fileName: file.originalname,
      fileSizeBytes: file.size,
      failed: true,
      error: source.ingestionError
    });

    return {
      source: serializeKnowledgeSourceForAdmin(source.toObject()),
      uploadedFile: documentMetadata,
      ingestionStatus: source.ingestionStatus,
      error: source.ingestionError
    };
  }
};

export const ingestKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: IngestKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  assertMergedKnowledgeSourceGovernance(source, {});
  const normalizedMetadata = normalizeKnowledgeSourceMetadata(input.metadata);

  source.ingestionStatus = 'fetched';
  source.ingestionError = undefined;
  source.metadata = withSearchReadiness(
    {
      ...toMetadataRecord(source.metadata),
      ...toMetadataRecord(normalizedMetadata),
      processingStage: 'indexing',
      processingError: undefined,
      indexingError: undefined
    },
    'indexing'
  );
  await source.save();

  try {
    const resolvedText = await resolveKnowledgeSourceText(source, input);

    if (resolvedText.text.length < OFFICIAL_REFRESH_MIN_TEXT_LENGTH) {
      throw new ApiError(
        StatusCodes.UNPROCESSABLE_ENTITY,
        'Extracted document text was too short to index safely. The PDF may be scanned or image-only; OCR is not supported yet.'
      );
    }

    const result = await embedKnowledgeSourceText(source, resolvedText.text, {
      expectedSha256: input.expectedSha256,
      metadata: {
        ...toMetadataRecord(normalizedMetadata),
        ...toMetadataRecord(resolvedText.metadata)
      },
      refreshMode: 'admin_ingest',
      contentType: resolvedText.contentType,
      contentLength: resolvedText.contentLength
    });

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      requiresHumanReview: source.status !== 'approved'
    });

    return {
      source: serializeKnowledgeSourceForAdmin(source.toObject()),
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      extractedLegalMetadata: result.extractedLegalMetadata,
      reviewStatus: 'pending_human_review'
    };
  } catch (error) {
    source.ingestionStatus = 'failed';
    source.ingestionError =
      error instanceof Error ? error.message : 'Knowledge source ingestion failed';
    source.metadata = withSearchReadiness({
      ...toMetadataRecord(source.metadata),
      processingStage: 'failed',
      processingError: source.ingestionError,
      extractionStatus: source.metadata.extractionStatus ?? 'failed'
    }, 'failed');
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
  const normalizedInput = normalizeKnowledgeSourceInput(input);

  if (!source.url && !normalizedInput.content && !normalizedInput.localFilePath) {
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
  source.metadata = withSearchReadiness(
    {
      ...toMetadataRecord(source.metadata),
      ...toMetadataRecord(normalizedInput.metadata),
      processingStage: 'indexing',
      processingError: undefined,
      indexingError: undefined
    },
    'indexing'
  );
  await source.save();

  try {
    if (normalizedInput.content || normalizedInput.localFilePath) {
      const text = await readIngestionText(normalizedInput);
      const result = await embedKnowledgeSourceText(source, text, {
        expectedSha256: normalizedInput.expectedSha256,
        metadata: normalizedInput.metadata,
        verificationDate,
        nextRefreshAt: normalizedInput.nextRefreshAt,
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
        source: serializeKnowledgeSourceForAdmin(source.toObject()),
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
        normalizedInput.nextRefreshAt ?? addDays(verificationDate, OFFICIAL_REFRESH_DEFAULT_DAYS);
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

      source.metadata = withSearchReadiness({
        ...toMetadataRecord(source.metadata),
        ...toMetadataRecord(normalizedInput.metadata),
        chunkCount: 0,
        indexedChunkCount: 0,
        sha256Verified: Boolean(fetched.sha256Hash),
        contentHashChanged: hashChanged,
        processingStage: 'not_indexed',
        processingError: undefined,
        indexingError: undefined,
        refreshMode: 'metadata_only',
        refreshMessage: fetched.message,
        contentType: fetched.contentType,
        contentLength: fetched.contentLength,
        lastVerifiedAt: verificationDate.toISOString()
      }, 'not_indexed');
      await source.save();

      await auditRagAction(context, RAG_ACTIONS.sourceRefresh, source._id.toString(), {
        mode: 'metadata_only',
        message: fetched.message,
        sha256Hash: source.sha256Hash,
        hashChanged,
        requiresHumanReview: true
      });

      return {
        source: serializeKnowledgeSourceForAdmin(source.toObject()),
        chunkCount: 0,
        sha256Hash: source.sha256Hash,
        metadataOnly: true,
        ingestionStatus: source.ingestionStatus,
        message: fetched.message,
        reviewStatus: 'metadata_only_needs_extracted_text'
      };
    }

    const result = await embedKnowledgeSourceText(source, fetched.text, {
      expectedSha256: normalizedInput.expectedSha256,
      metadata: normalizedInput.metadata,
      verificationDate,
      nextRefreshAt: normalizedInput.nextRefreshAt,
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
      source: serializeKnowledgeSourceForAdmin(source.toObject()),
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
    source.metadata = withSearchReadiness({
      ...toMetadataRecord(source.metadata),
      processingStage: 'failed',
      processingError: source.ingestionError
    }, 'failed');
    await source.save();
    throw error;
  }
};

export const approveKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  assertMergedKnowledgeSourceGovernance(source, {});

  const approvalBlocker = getKnowledgeSourceApprovalBlocker(source);

  if (approvalBlocker) {
    throw new ApiError(approvalBlocker.statusCode, approvalBlocker.message);
  }

  source.status = 'approved';
  source.approvedBy = context.owner.userId as never;
  source.approvedAt = new Date();
  source.lastVerifiedAt = new Date();
  if (source.ingestionStatus === 'embedded') {
    source.ingestionError = undefined;
  }
  await source.save();

  await auditRagAction(context, RAG_ACTIONS.sourceApprove, source._id.toString());

  return serializeKnowledgeSourceForAdmin(source.toObject());
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

  return serializeKnowledgeSourceForAdmin(source.toObject());
};

export const reindexKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
  const source = await getSource(sourceId);

  if (!source.rawText) {
    throw new ApiError(StatusCodes.CONFLICT, 'Knowledge source has no ingested text to reindex');
  }

  await RagChunkModel.updateMany(
    { sourceId: source._id },
    {
      $set: {
        'metadata.embeddingStatus': 'pending',
        'metadata.embeddingError': undefined,
        'metadata.pineconeVectorId': undefined,
        'metadata.pineconeIndexedAt': undefined
      }
    }
  );

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

const timelineIncidentTopics: Partial<Record<string, RagTopic[]>> = {
  domestic_violence: ['dv', 'support', 'crisis', 'evidence'],
  racial_abuse: ['racial_hatred', 'discrimination', 'support', 'evidence'],
  migrant_challenges: ['support', 'discrimination', 'other'],
  cyber_scam: ['scam', 'online_safety', 'support', 'evidence']
};

const timelineIncidentSourceCategories: Partial<Record<string, RagSourceCategory[]>> = {
  domestic_violence: ['official_support_source', 'official_legal_source', 'admin_content'],
  racial_abuse: ['official_legal_source', 'official_support_source', 'admin_content'],
  migrant_challenges: ['official_support_source', 'official_legal_source', 'admin_content'],
  cyber_scam: ['official_support_source', 'official_legal_source', 'admin_content']
};

const uniqueByChunkId = (results: RagSearchResult[]): RagSearchResult[] => {
  const seen = new Set<string>();
  const deduped: RagSearchResult[] = [];

  for (const result of results) {
    if (seen.has(result.chunkId)) {
      continue;
    }

    seen.add(result.chunkId);
    deduped.push(result);
  }

  return deduped;
};

const buildTimelineRagCategories = (input: RagTimelineAssistantInput): RagSourceCategory[] => {
  const categories = new Set<RagSourceCategory>();
  const classifiedCategory = classifySourceCategory({
    query: input.message,
    language: input.language,
    jurisdiction: input.jurisdiction,
    topK: input.topK
  });

  categories.add(classifiedCategory);

  for (const category of timelineIncidentSourceCategories[input.incidentCategory ?? ''] ?? []) {
    categories.add(category);
  }

  categories.add('admin_content');
  categories.add('internal_product_rule');

  return Array.from(categories);
};

type TimelineRagQuery = {
  sourceCategory: RagSourceCategory;
  topic?: RagTopic;
};

const buildTimelineRagQueries = (
  input: RagTimelineAssistantInput
): TimelineRagQuery[] => {
  const categories = buildTimelineRagCategories(input);
  const incidentTopics = timelineIncidentTopics[input.incidentCategory ?? ''] ?? [];

  if (incidentTopics.length === 0) {
    return categories.map((sourceCategory) => ({ sourceCategory }));
  }

  return categories.flatMap<TimelineRagQuery>((sourceCategory) => {
    if (sourceCategory === 'internal_product_rule') {
      return [{ sourceCategory }];
    }

    return [
      ...incidentTopics.map((topic) => ({ sourceCategory, topic })),
      { sourceCategory }
    ];
  });
};

const searchTimelineRag = async (
  context: RagServiceContext,
  input: RagTimelineAssistantInput
): Promise<RagSearchResult[]> => {
  const searches = buildTimelineRagQueries(input);
  const maxResults = input.topK ?? DEFAULT_RAG_TOP_K;
  const collected: RagSearchResult[] = [];

  for (const search of searches) {
    try {
      const results = await searchRag(context, {
        query: input.message,
        topK: maxResults,
        language: input.language,
        jurisdiction: input.jurisdiction,
        sourceCategory: search.sourceCategory,
        topic: search.topic
      });

      collected.push(...results);
    } catch (error) {
      if (isVectorSearchUnavailable(error)) {
        throw error;
      }

      throw error;
    }

    if (uniqueByChunkId(collected).length >= maxResults) {
      break;
    }
  }

  return uniqueByChunkId(collected)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, maxResults);
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

const searchRagWithPinecone = async (
  input: RagSearchInput,
  category: RagSourceCategory,
  sourceFilter: FilterQuery<RagKnowledgeSourceDocument>,
  queryVector: number[],
  sourceIds: unknown[]
): Promise<RagSearchResult[]> => {
  const vectorResults = await pineconeVectorStore.search({
    vector: queryVector,
    topK: Math.max(input.topK ?? DEFAULT_RAG_TOP_K, DEFAULT_RAG_TOP_K),
    filters: {
      sourceCategory: category,
      jurisdiction: input.jurisdiction,
      topic: input.topic,
      sourceIds: sourceIds.map((sourceId) => String(sourceId))
    }
  });

  if (vectorResults.length === 0) {
    return [];
  }

  const scoreByChunkId = new Map(vectorResults.map((result) => [result.chunkId, result.score]));
  const orderByChunkId = new Map(vectorResults.map((result, index) => [result.chunkId, index]));
  const chunkIds = vectorResults.map((result) => result.chunkId);
  const candidateSourceIds = Array.from(new Set(vectorResults.map((result) => result.sourceId)));
  const sources = await RagKnowledgeSourceModel.find({
    ...sourceFilter,
    _id: { $in: candidateSourceIds }
  }).lean();
  const sourceById = new Map(sources.map((source) => [source._id.toString(), source]));
  const chunks = await RagChunkModel.find({
    _id: { $in: chunkIds },
    sourceId: { $in: sources.map((source) => source._id) }
  }).lean();

  const results: RagSearchResult[] = [];

  for (const chunk of chunks) {
      const source = sourceById.get(chunk.sourceId.toString());

      if (!source) {
        continue;
      }

      results.push({
        chunkId: chunk._id.toString(),
        sourceId: chunk.sourceId.toString(),
        title: source.title,
        publisher: source.publisher,
        sourceCategory: source.sourceCategory,
        sourceType: source.sourceType,
        jurisdiction: source.jurisdiction,
        topic: source.topic,
        sectionRef: chunk.sectionRef,
        citationUrl: chunk.citationUrl,
        lastUpdated: source.lastUpdated,
        text: chunk.chunkText,
        score: scoreByChunkId.get(chunk._id.toString()),
        metadata: chunk.metadata ?? {}
      });
  }

  return results
    .sort(
      (left, right) =>
        (orderByChunkId.get(left.chunkId) ?? Number.MAX_SAFE_INTEGER) -
        (orderByChunkId.get(right.chunkId) ?? Number.MAX_SAFE_INTEGER)
    )
    .slice(0, input.topK ?? DEFAULT_RAG_TOP_K);
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
  const eligibleSources = await RagKnowledgeSourceModel.find(sourceFilter)
    .select('_id metadata')
    .sort({ lastUpdated: -1 })
    .lean();
  const sourceIds = eligibleSources.map((source) => source._id);

  if (sourceIds.length === 0) {
    return [];
  }

  const queryVector = await createEmbedding(input.query);
  const pineconeCoverageIncomplete = eligibleSources.some((source) => {
    const metadata = toMetadataRecord(source.metadata);
    const chunkCount = metadataNumber(metadata, 'chunkCount') ?? 0;

    if (chunkCount <= 0) {
      return false;
    }

    const indexedChunkCount = metadataNumber(metadata, 'indexedChunkCount') ?? 0;

    return (
      Boolean(metadataString(metadata, 'indexingError')) ||
      !metadataString(metadata, 'pineconeIndexedAt') ||
      indexedChunkCount < chunkCount
    );
  });

  if (isPineconeConfigured() && !pineconeCoverageIncomplete) {
    try {
      const pineconeResults = await searchRagWithPinecone(
        input,
        sourceCategory,
        sourceFilter,
        queryVector,
        sourceIds
      );

      await auditRagAction(context, RAG_ACTIONS.search, undefined, {
        resultCount: pineconeResults.length,
        topK: input.topK ?? DEFAULT_RAG_TOP_K,
        vectorStore: 'pinecone'
      });

      return pineconeResults;
    } catch (error) {
      logger.error(
        {
          error,
          sourceCategory,
          indexName: getPineconeIndexName(),
          namespace: getPineconeNamespace()
        },
        'Pinecone RAG search failed; falling back to Mongo vector search'
      );
    }
  } else if (isPineconeConfigured() && pineconeCoverageIncomplete) {
    logger.warn(
      {
        sourceCategory,
        eligibleSourceCount: eligibleSources.length,
        indexName: getPineconeIndexName(),
        namespace: getPineconeNamespace()
      },
      'Pinecone coverage incomplete for eligible sources; using Mongo vector search fallback'
    );
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
    topK: input.topK ?? DEFAULT_RAG_TOP_K,
    vectorStore: 'mongo'
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
    results = await searchTimelineRag(context, input);
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
