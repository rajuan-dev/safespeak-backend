import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StatusCodes } from 'http-status-codes';
import { Types, type FilterQuery, type HydratedDocument, type PipelineStage } from 'mongoose';
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
import { resolveAssistantLanguage } from '@modules/ai/assistant-language';
import { escapeUnicodeForLog, hasBrokenTextEncoding } from '@modules/ai/text-encoding';
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
import { getOcrProvider } from './ocr/ocr-provider.factory';
import type { RagOcrExtractResult, RagOcrPageResult } from './ocr/ocr-provider.interface';
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
  ApproveOcrKnowledgeSourceInput,
  CreateKnowledgeSourceInput,
  KnowledgeSourceOcrPreviewQueryInput,
  KnowledgeSourceChunkQueryInput,
  IngestKnowledgeSourceInput,
  RagAnswerInput,
  RagDebugRetrieveInput,
  RagSearchInput,
  RagTimelineAssistantInput,
  RefreshKnowledgeSourceInput,
  RejectKnowledgeSourceInput,
  UpdateKnowledgeSourceInput
} from './rag.schema';
import type {
  RagJurisdiction,
  RagLegalDomain,
  RagKnowledgeReadinessBlocker,
  RagKnowledgeReadinessCoverageCell,
  RagLegalAwareness,
  RagOwner,
  RagPathwayCategory,
  RagSearchResult,
  RagServiceContext,
  RagKnowledgeSourceReadiness,
  RagOcrProgress,
  RagOcrStatus,
  RagSourceCategory,
  RagStateOrTerritory,
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
const OCR_MIN_TEXT_LENGTH = 120;
const OCR_PAGE_FAILURE_RATIO_LIMIT = 0.4;
const OCR_SYMBOL_HEAVY_RATIO_LIMIT = 0.45;
const PINECONE_SEARCH_CANDIDATE_MULTIPLIER = 5;
const PINECONE_SEARCH_MIN_CANDIDATES = 20;
const KNOWLEDGE_DOCUMENT_ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
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
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
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

const shouldUsePineconeProvider = (): boolean =>
  env.RAG_VECTOR_PROVIDER === 'pinecone' || env.RAG_VECTOR_PROVIDER === 'hybrid';

const shouldAllowMongoFallback = (): boolean =>
  env.RAG_VECTOR_PROVIDER === 'mongo' || env.RAG_VECTOR_PROVIDER === 'hybrid';

const resolveDefaultStateOrTerritory = (
  jurisdiction?: RagJurisdiction
): RagStateOrTerritory | undefined => {
  switch (jurisdiction) {
    case 'Cth':
      return 'FEDERAL';
    case 'AU':
      return 'AU';
    case 'NSW':
    case 'VIC':
    case 'QLD':
    case 'WA':
    case 'SA':
    case 'TAS':
    case 'ACT':
    case 'NT':
      return jurisdiction;
    default:
      return undefined;
  }
};

const resolveDefaultLegalDomain = (
  sourceCategory: RagSourceCategory,
  topic: RagTopic
): RagLegalDomain => {
  switch (topic) {
    case 'racial':
    case 'racial_hatred':
      return 'discrimination';
    case 'workplace':
      return 'workplace';
    case 'dv':
      return 'domestic_family_violence';
    case 'online_safety':
      return 'online_safety';
    case 'scam':
      return 'scam_fraud';
    case 'privacy':
      return 'privacy';
    case 'migrant':
      return 'migration';
    case 'support':
    case 'crisis':
      return 'support_service';
    default:
      return sourceCategory === 'official_legal_source' ? 'civil_law' : 'support_service';
  }
};

const resolveDefaultPathwayCategory = (
  topic: RagTopic,
  legalDomain?: RagLegalDomain
): RagPathwayCategory => {
  switch (topic) {
    case 'scam':
      return 'scam_response';
    case 'workplace':
      return 'workplace_options';
    case 'online_safety':
      return 'online_abuse';
    case 'dv':
      return 'domestic_family_violence';
    case 'evidence':
      return 'evidence_guidance';
    case 'crisis':
      return 'safety_planning';
    default:
      return legalDomain === 'support_service' ? 'support' : 'legal_information';
  }
};

const resolveSourceReliability = (
  sourceCategory: RagSourceCategory
): 'official' | 'trusted_partner' | 'internal' | 'unknown' => {
  if (sourceCategory === 'official_legal_source') {
    return 'official';
  }

  if (sourceCategory === 'official_support_source') {
    return 'trusted_partner';
  }

  if (sourceCategory === 'internal_product_rule') {
    return 'internal';
  }

  return 'unknown';
};

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
  | 'ocr_review_pending'
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
  | 'ocrReviewRequired'
  | 'ocrStatus'
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

  if (source.ocrReviewRequired && source.ocrStatus !== 'reviewed') {
    return {
      code: 'ocr_review_pending',
      statusCode: StatusCodes.CONFLICT,
      message: 'OCR-derived knowledge sources must be reviewed before approval'
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

export const resolveSearchJurisdictions = (
  jurisdiction: RagJurisdiction | undefined,
  category: RagSourceCategory
): RagJurisdiction[] | undefined => {
  if (!jurisdiction) {
    return undefined;
  }

  if (isGovernedKnowledgeSource(category) && isNswSpecificJurisdiction(jurisdiction)) {
    return [jurisdiction, 'Cth', 'AU'];
  }

  if (isGovernedKnowledgeSource(category) && jurisdiction === 'AU') {
    return ['AU', 'Cth'];
  }

  return [jurisdiction];
};

const buildJurisdictionFilter = (
  jurisdiction: RagJurisdiction | undefined,
  category: RagSourceCategory
): FilterQuery<RagKnowledgeSourceDocument> => {
  const searchJurisdictions = resolveSearchJurisdictions(jurisdiction, category);

  if (!searchJurisdictions || searchJurisdictions.length === 0) {
    return {};
  }

  return searchJurisdictions.length === 1
    ? { jurisdiction: searchJurisdictions[0] }
    : { jurisdiction: { $in: searchJurisdictions } };
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
const LEGISLATION_PAGE_MARKER_PATTERN = /^--\s*\d+\s+of\s+\d+\s*--$/i;
const LEGISLATION_DOT_LEADER_PATTERN = /\.{8,}\s*\d+\s*$/;
const LEGISLATION_RUNNING_HEADER_PATTERN =
  /^(?:[A-Z][A-Za-z'’().,&/-]+(?:\s+[A-Z][A-Za-z'’().,&/-]+){0,8}\s+(?:Act|Regulation|Code|Charter|Constitution|Policy))(?:\s+\d{4})?\s+(?:\d+|[ivxlcdm]+)$/i;
const LEGISLATION_PAGE_NUMBER_TITLE_PATTERN =
  /^(?:\d{1,4}|[ivxlcdm]+)\s+(?:[A-Z][A-Za-z'’().,&/-]+(?:\s+[A-Z][A-Za-z'’().,&/-]+){0,8}\s+(?:Act|Regulation|Code|Charter|Constitution|Policy))(?:\s+\d{4})?$/i;
const LEGAL_QUERY_STOP_WORDS = new Set([
  'according',
  'act',
  'an',
  'and',
  'are',
  'by',
  'deals',
  'does',
  'for',
  'is',
  'of',
  'section',
  'the',
  'to',
  'under',
  'uploaded',
  'what',
  'which',
  'with'
]);

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

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeLegalSearchText = (value: string): string =>
  collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeSectionReferenceValue = (value: string): string =>
  normalizeLegalSearchText(value).replace(/^(section|schedule|clause|cl|s)\s+/, '').trim();

const extractExplicitSectionReferences = (value: string): string[] =>
  Array.from(
    new Set(
      Array.from(
        value.matchAll(/\b(?:section|sections|schedule|s\.?|clause|cl\.?)\s*([0-9A-Za-z().-]+)/gi)
      )
        .map((match) => normalizeSectionReferenceValue(match[1] ?? ''))
        .filter(Boolean)
    )
  );

const extractImportantLegalTerms = (value: string): string[] =>
  Array.from(
    new Set(
      normalizeLegalSearchText(value)
        .split(' ')
        .filter(
          (term) =>
            term.length >= 3 &&
            !LEGAL_QUERY_STOP_WORDS.has(term) &&
            !/^\d+$/.test(term)
        )
    )
  );

const buildLegalSearchLabel = (result: Pick<RagSearchResult, 'title' | 'sectionRef' | 'metadata'>): string => {
  const metadata = toMetadataRecord(result.metadata);
  const sectionHeading = metadataString(metadata, 'sectionHeading');

  return [result.title, result.sectionRef, sectionHeading].filter(Boolean).join(' ');
};

const looksLikeTableOfContentsChunk = (text: string): boolean =>
  LEGISLATION_DOT_LEADER_PATTERN.test(text) || /(^|\n)contents(\n|$)/i.test(text);

const isLikelyLegislationRunningHeaderLine = (line: string): boolean => {
  const trimmed = line.trim();

  return (
    LEGISLATION_PAGE_MARKER_PATTERN.test(trimmed) ||
    LEGISLATION_DOT_LEADER_PATTERN.test(trimmed) ||
    /^Authorised Version\b/i.test(trimmed) ||
    /^Compilation No\.\s*\d+/i.test(trimmed) ||
    LEGISLATION_RUNNING_HEADER_PATTERN.test(trimmed) ||
    LEGISLATION_PAGE_NUMBER_TITLE_PATTERN.test(trimmed)
  );
};

const shouldSkipLegislationLine = (line: string): boolean => {
  const trimmed = line.trim();

  return !trimmed || isLikelyLegislationRunningHeaderLine(trimmed);
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

export const detectLegalHeading = (
  line: string
): Partial<Omit<LegislationChunkCandidate, 'text'>> | undefined => {
  const trimmed = line.trim();

  if (!trimmed || shouldSkipLegislationLine(trimmed)) {
    return undefined;
  }

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
    if (shouldSkipLegislationLine(line)) {
      continue;
    }

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
  extracted?: ExtractedDocumentResult;
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

  let resolvedExtracted = extracted;

  if (
    env.RAG_ENABLE_OCR &&
    shouldRequireOcrForExtraction({
      text: extracted.text,
      extractor: extracted.extractor,
      mimeType: storedDocument.mimetype,
      fileName: storedDocument.originalname
    })
  ) {
    resolvedExtracted = await runOcrForStoredDocument(source);
  }

  return {
    text: resolvedExtracted.text,
    extracted: resolvedExtracted,
    contentType: storedDocument.mimetype,
    contentLength: storedDocument.size,
    metadata: {
      uploadedFile: sourceMetadata.uploadedFile,
      extractedPageCount: resolvedExtracted.pageCount,
      extractionMethod: resolvedExtracted.extractionMethod,
      extractionQualityScore: resolvedExtracted.qualityScore,
      extractionStatus: 'extracted',
      ocrProvider: resolvedExtracted.ocrProvider,
      ocrAverageConfidence: resolvedExtracted.ocrAverageConfidence,
      ocrWarnings: resolvedExtracted.ocrWarnings,
      ocrPages: resolvedExtracted.pages,
      processingStage: 'indexing',
      processingError: undefined,
      ingestionPipeline: {
        ...toMetadataRecord(sourceMetadata.ingestionPipeline),
        extractor: resolvedExtracted.extractor
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

type ExtractedDocumentResult = {
  text: string;
  extractor: string;
  pageCount?: number;
  totalPages?: number;
  qualityScore: number;
  extractionMethod: 'text' | 'ocr' | 'manual' | 'url';
  ocrProvider?: string;
  ocrAverageConfidence?: number;
  ocrWarnings?: string[];
  pages?: Array<{
    pageNumber: number;
    text: string;
    confidence: number;
    warnings: string[];
    processingTimeMs?: number;
    status?: 'completed' | 'failed' | 'skipped' | 'low_confidence';
  }>;
  ocrProgress?: RagOcrProgress;
};

type OcrQualityAssessment = {
  passed: boolean;
  status: RagOcrStatus;
  reason?: string;
  warnings: string[];
  failedPageCount: number;
  garbageLikely: boolean;
};

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

const getStoredKnowledgeDocumentPath = (
  source: Pick<RagKnowledgeSourceDocument, 'metadata'>
): string | null => {
  const sourceMetadata = toMetadataRecord(source.metadata);
  const uploadedFile = toMetadataRecord(sourceMetadata.uploadedFile);
  const storageKey = metadataString(uploadedFile, 'storageKey');

  return storageKey ? getKnowledgeDocumentStoragePath(storageKey) : null;
};

const buildDerivedSourceFields = (input: {
  title?: string;
  sourceTitle?: string;
  publisher?: string;
  sourceAuthority?: string;
  url?: string;
  officialUrl?: string;
  jurisdiction?: RagJurisdiction;
  sourceCategory?: RagSourceCategory;
  topic?: RagTopic;
  legalDomain?: RagLegalDomain;
  pathwayCategory?: RagPathwayCategory;
  stateOrTerritory?: RagStateOrTerritory;
  sourceReliability?: RagKnowledgeSourceDocument['sourceReliability'];
}): Partial<RagKnowledgeSourceDocument> => {
  const legalDomain =
    input.legalDomain ??
    (input.sourceCategory && input.topic
      ? resolveDefaultLegalDomain(input.sourceCategory, input.topic)
      : undefined);

  return {
    sourceTitle: input.sourceTitle ?? input.title,
    sourceAuthority: input.sourceAuthority ?? input.publisher,
    officialUrl: input.officialUrl ?? input.url,
    country: 'Australia',
    stateOrTerritory: input.stateOrTerritory ?? resolveDefaultStateOrTerritory(input.jurisdiction),
    legalDomain,
    pathwayCategory:
      input.pathwayCategory ??
      (input.topic ? resolveDefaultPathwayCategory(input.topic, legalDomain) : undefined),
    sourceReliability:
      input.sourceReliability ??
      (input.sourceCategory ? resolveSourceReliability(input.sourceCategory) : 'unknown')
  };
};

const estimateExtractionQuality = (text: string): number => {
  const trimmed = text.trim();

  if (!trimmed) {
    return 0;
  }

  const alphaNumericChars = (trimmed.match(/[A-Za-z0-9]/g) ?? []).length;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const uniqueWords = new Set(trimmed.toLowerCase().split(/\s+/).filter(Boolean)).size;

  return Number(
    Math.max(
      0,
      Math.min(
        1,
        alphaNumericChars / Math.max(trimmed.length, 1) * 0.5 +
          Math.min(wordCount / 200, 1) * 0.3 +
          Math.min(uniqueWords / 120, 1) * 0.2
      )
    ).toFixed(3)
  );
};

const looksLikePdfOrImage = (mimeType?: string, extractor?: string, fileName?: string): boolean => {
  const extension = fileName ? getDocumentExtension(fileName) : '';
  const normalizedMimeType = (mimeType ?? '').toLowerCase();

  return (
    /pdf|image\//i.test(normalizedMimeType) ||
    extractor === 'pdf-parse' ||
    ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(extension)
  );
};

export const shouldRequireOcrForExtraction = (input: {
  text: string;
  extractor: string;
  mimeType?: string;
  fileName?: string;
}): boolean => {
  const qualityScore = estimateExtractionQuality(input.text);
  const looksLikeDocumentForOcr = looksLikePdfOrImage(input.mimeType, input.extractor, input.fileName);

  return (
    looksLikeDocumentForOcr &&
    (input.text.trim().length < OFFICIAL_REFRESH_MIN_TEXT_LENGTH || qualityScore < 0.3)
  );
};

const shouldRequireOcr = (input: {
  text: string;
  extractor: string;
  mimeType?: string;
  fileName?: string;
}): boolean => {
  if (env.RAG_ENABLE_OCR) {
    return false;
  }

  return shouldRequireOcrForExtraction(input);
};

const looksLikeMostlySymbols = (text: string): boolean => {
  const compact = text.replace(/\s+/g, '');

  if (!compact) {
    return true;
  }

  const symbolCount = (compact.match(/[^A-Za-z0-9]/g) ?? []).length;
  return symbolCount / compact.length >= OCR_SYMBOL_HEAVY_RATIO_LIMIT;
};

const countGarbagePages = (result: RagOcrExtractResult): number =>
  result.pages.filter((page) => !page.text.trim() || looksLikeMostlySymbols(page.text)).length;

export const assessOcrOutputQuality = (result: RagOcrExtractResult): OcrQualityAssessment => {
  const warnings = [...result.warnings];
  const textLength = result.text.trim().length;
  const failedPageCount = countGarbagePages(result);
  const garbageLikely = looksLikeMostlySymbols(result.text);
  const failedPageRatio = result.pageCount > 0 ? failedPageCount / result.pageCount : 1;

  if (result.averageConfidence < env.OCR_MIN_CONFIDENCE) {
    warnings.push(
      `Average OCR confidence ${result.averageConfidence.toFixed(3)} is below the configured minimum ${env.OCR_MIN_CONFIDENCE.toFixed(3)}.`
    );

    return {
      passed: false,
      status: 'low_confidence',
      reason: warnings[warnings.length - 1],
      warnings,
      failedPageCount,
      garbageLikely
    };
  }

  if (textLength < OCR_MIN_TEXT_LENGTH) {
    warnings.push('OCR output was too short to index safely.');
    return {
      passed: false,
      status: 'low_confidence',
      reason: warnings[warnings.length - 1],
      warnings,
      failedPageCount,
      garbageLikely
    };
  }

  if (failedPageRatio > OCR_PAGE_FAILURE_RATIO_LIMIT) {
    warnings.push('Too many OCR pages were blank or unreadable.');
    return {
      passed: false,
      status: 'failed',
      reason: warnings[warnings.length - 1],
      warnings,
      failedPageCount,
      garbageLikely
    };
  }

  if (garbageLikely) {
    warnings.push('OCR output appears to contain mostly symbols or mojibake.');
    return {
      passed: false,
      status: 'failed',
      reason: warnings[warnings.length - 1],
      warnings,
      failedPageCount,
      garbageLikely
    };
  }

  return {
    passed: true,
    status: 'completed',
    warnings,
    failedPageCount,
    garbageLikely
  };
};

export const isOcrSourceRetrievable = (input: {
  extractionMethod?: string;
  ocrReviewRequired?: boolean;
  ocrStatus?: string;
  ocrAverageConfidence?: number;
}): boolean => {
  if (input.extractionMethod !== 'ocr') {
    return true;
  }

  if ((input.ocrAverageConfidence ?? 0) < env.OCR_MIN_CONFIDENCE) {
    return false;
  }

  if (input.ocrReviewRequired && input.ocrStatus !== 'reviewed') {
    return false;
  }

  return true;
};

export const normalizeOcrExecutionOptions = (input?: {
  maxPages?: number;
  batchSize?: number;
  pageTimeoutMs?: number;
  jobTimeoutMs?: number;
}): Required<NonNullable<typeof input>> => ({
  maxPages: input?.maxPages ?? env.OCR_MAX_PAGES,
  batchSize: input?.batchSize ?? env.OCR_BATCH_SIZE,
  pageTimeoutMs: input?.pageTimeoutMs ?? env.OCR_PAGE_TIMEOUT_MS,
  jobTimeoutMs: input?.jobTimeoutMs ?? env.OCR_JOB_TIMEOUT_MS
});

export const buildOcrStatusSummary = (
  source: Pick<
    RagKnowledgeSourceDocument,
    | '_id'
    | 'title'
    | 'sourceTitle'
    | 'ingestionStatus'
    | 'active'
    | 'legalReviewed'
    | 'extractionMethod'
    | 'ocrStatus'
    | 'ocrAverageConfidence'
    | 'ocrPageCount'
    | 'ocrProvider'
    | 'ocrWarnings'
    | 'embeddingModel'
    | 'pineconeIndex'
    | 'pineconeNamespace'
    | 'metadata'
  >
): Record<string, unknown> => {
  const metadata = toMetadataRecord(source.metadata);

  return {
    id: source._id.toString(),
    sourceTitle: source.sourceTitle ?? source.title,
    ingestionStatus: source.ingestionStatus,
    active: source.active,
    legalReviewed: source.legalReviewed,
    extractionMethod: source.extractionMethod,
    ocrStatus: source.ocrStatus,
    ocrProgress: metadata.ocrProgress,
    ocrAverageConfidence: source.ocrAverageConfidence,
    ocrPageCount: source.ocrPageCount,
    ocrProvider: source.ocrProvider,
    ocrWarnings: source.ocrWarnings ?? [],
    embeddingModel: source.embeddingModel,
    pineconeIndex: source.pineconeIndex,
    pineconeNamespace: source.pineconeNamespace,
    indexSyncStatus: metadata.indexSyncStatus,
    mongoChunkCount: metadata.mongoChunkCount,
    pineconeVectorCount: metadata.pineconeVectorCount,
    lastIndexedAt: metadata.lastIndexedAt,
    indexSyncError: metadata.indexSyncError
  };
};

export const paginateOcrPages = (
  pages: unknown[],
  page: number,
  pageSize: number
): { page: number; pageSize: number; totalPages: number; pages: unknown[] } => {
  const totalPages = pages.length;
  const start = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    totalPages,
    pages: pages.slice(start, start + pageSize)
  };
};

const clearSourceIndexArtifacts = async (
  source: Pick<RagKnowledgeSourceDocument, '_id'>
): Promise<void> => {
  if (shouldUsePineconeProvider() && isPineconeConfigured()) {
    await pineconeVectorStore.deleteBySource(source._id.toString());
  }

  await RagChunkModel.deleteMany({ sourceId: source._id });
};

const extractTextFromUploadedDocument = async (
  file: UploadedKnowledgeDocument
): Promise<ExtractedDocumentResult> => {
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
        pageCount: typeof parsedPageCount === 'number' ? parsedPageCount : undefined,
        qualityScore: estimateExtractionQuality(parsed.text),
        extractionMethod: 'text'
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

    return {
      text: parsed.value.trim(),
      extractor: 'mammoth',
      qualityScore: estimateExtractionQuality(parsed.value),
      extractionMethod: 'text'
    };
  }

  if (extension === '.doc' || mimeType === 'application/msword') {
    throw new ApiError(
      StatusCodes.UNPROCESSABLE_ENTITY,
      'Legacy .doc extraction is not supported. Convert the document to .docx or PDF and upload again.'
    );
  }

  const rawText = file.buffer.toString('utf8');

  if (extension === '.html' || extension === '.htm' || /html/i.test(file.mimetype)) {
    const text = htmlToText(rawText);
    return {
      text,
      extractor: 'html-to-text',
      qualityScore: estimateExtractionQuality(text),
      extractionMethod: 'text'
    };
  }

  if (['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(extension) || /^image\//i.test(mimeType)) {
    return {
      text: '',
      extractor: 'image-upload',
      qualityScore: 0,
      extractionMethod: 'text'
    };
  }

  const text = rawText.trim();
  return {
    text,
    extractor: 'plain-text',
    qualityScore: estimateExtractionQuality(text),
    extractionMethod: 'text'
  };
};

const mapOcrResultToExtractedDocument = (ocrResult: RagOcrExtractResult): ExtractedDocumentResult => ({
  text: ocrResult.text,
  extractor: `${ocrResult.provider}-ocr`,
  pageCount: ocrResult.pageCount,
  totalPages: ocrResult.totalPages,
  qualityScore: estimateExtractionQuality(ocrResult.text),
  extractionMethod: 'ocr',
  ocrProvider: ocrResult.provider,
  ocrAverageConfidence: ocrResult.averageConfidence,
  ocrWarnings: ocrResult.warnings,
  pages: ocrResult.pages,
  ocrProgress: ocrResult.progress
});

type RunOcrOptions = {
  maxPages?: number;
  batchSize?: number;
  pageTimeoutMs?: number;
  jobTimeoutMs?: number;
  onProgress?: (progress: RagOcrProgress, extracted?: ExtractedDocumentResult) => Promise<void> | void;
};

const runOcrForStoredDocument = async (
  source: Pick<RagKnowledgeSourceDocument, 'metadata'>,
  input?: RunOcrOptions
): Promise<ExtractedDocumentResult> => {
  const absolutePath = getStoredKnowledgeDocumentPath(source);

  if (!absolutePath) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'No uploaded document is available for OCR.');
  }

  const uploadedFile = toMetadataRecord(toMetadataRecord(source.metadata).uploadedFile);
  const originalFileName = metadataString(uploadedFile, 'originalFileName') ?? absolutePath;
  const mimeType = metadataString(uploadedFile, 'mimeType') ?? 'application/octet-stream';
  const extension = getDocumentExtension(originalFileName);
  const ocrProvider = getOcrProvider();
  const options = {
    language: env.OCR_LANGUAGE,
    maxPages: input?.maxPages ?? env.OCR_MAX_PAGES,
    batchSize: input?.batchSize ?? env.OCR_BATCH_SIZE,
    pageTimeoutMs: input?.pageTimeoutMs ?? env.OCR_PAGE_TIMEOUT_MS,
    jobTimeoutMs: input?.jobTimeoutMs ?? env.OCR_JOB_TIMEOUT_MS,
    minConfidence: env.OCR_MIN_CONFIDENCE,
    onProgress: async (progress: RagOcrProgress, page?: RagOcrPageResult) => {
      if (!input?.onProgress) {
        return;
      }

      await input.onProgress(progress, {
        text: page?.text ?? '',
        extractor: `${ocrProvider.providerName}-ocr`,
        pageCount: progress.processedPages,
        totalPages: progress.totalPages,
        qualityScore: estimateExtractionQuality(page?.text ?? ''),
        extractionMethod: 'ocr',
        ocrProvider: ocrProvider.providerName,
        ocrAverageConfidence: undefined,
        ocrWarnings: page?.warnings ?? [],
        pages: page ? [page] : [],
        ocrProgress: progress
      });
    }
  };

  if (extension === '.pdf' || /pdf/i.test(mimeType)) {
    return mapOcrResultToExtractedDocument(await ocrProvider.extractTextFromPdf(absolutePath, options));
  }

  if (['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(extension) || /^image\//i.test(mimeType)) {
    return mapOcrResultToExtractedDocument(
      await ocrProvider.extractTextFromImage(absolutePath, options)
    );
  }

  throw new ApiError(
    StatusCodes.BAD_REQUEST,
    'OCR is only supported for uploaded PDF and image documents.'
  );
};

const shouldAutoReviewOcrForAdmin = (
  context: Pick<RagServiceContext, 'actorType' | 'owner'>
): boolean => context.actorType === 'admin' && Boolean(context.owner.userId);

const getOcrReviewRequired = (
  source: Pick<RagKnowledgeSourceDocument, 'sourceCategory'>,
  options?: { autoReview?: boolean }
): boolean => {
  if (options?.autoReview) {
    return false;
  }

  return source.sourceCategory === 'official_legal_source' ? true : env.OCR_REVIEW_REQUIRED;
};

const buildOcrMetadata = (
  extracted: ExtractedDocumentResult,
  assessment: OcrQualityAssessment,
  options?: { reviewedAt?: string; reviewedBy?: string; reviewRequired?: boolean }
): Record<string, unknown> => ({
  extractionMethod: extracted.extractionMethod,
  extractedPageCount: extracted.pageCount,
  extractionQualityScore: extracted.qualityScore,
  ocrProvider: extracted.ocrProvider,
  ocrAverageConfidence: extracted.ocrAverageConfidence,
  ocrPageCount: extracted.pageCount,
  ocrWarnings: assessment.warnings,
  ocrReviewRequired: options?.reviewedAt ? false : (options?.reviewRequired ?? env.OCR_REVIEW_REQUIRED),
  ocrReviewedAt: options?.reviewedAt,
  ocrReviewedBy: options?.reviewedBy,
  ocrStatus: options?.reviewedAt ? 'reviewed' : assessment.status,
  ocrProgress: extracted.ocrProgress,
  ocrPages: extracted.pages
});

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
    sourceAuthority?: string;
    officialUrl?: string;
    country?: string;
    stateOrTerritory?: string;
    pathwayCategory?: string;
    legalDomain?: string;
    legislationName?: string;
    active?: boolean;
    sourceReliability?: string;
    embeddingModel?: string;
    pineconeIndex?: string;
    pineconeNamespace?: string;
    extractionMethod?: string;
    ocrProvider?: string;
    ocrAverageConfidence?: number;
    ocrPageCount?: number;
    ocrWarnings?: string[];
    ocrReviewRequired?: boolean;
    ocrReviewedAt?: unknown;
    ocrReviewedBy?: unknown;
    ocrStatus?: string;
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
    ocrProgress: sanitizedMetadata.ocrProgress,
    indexSyncStatus: sanitizedMetadata.indexSyncStatus,
    mongoChunkCount: sanitizedMetadata.mongoChunkCount,
    pineconeVectorCount: sanitizedMetadata.pineconeVectorCount,
    lastIndexedAt: sanitizedMetadata.lastIndexedAt,
    indexSyncError: sanitizedMetadata.indexSyncError,
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
    sourceTitle: source.sourceTitle ?? source.title,
    sourceAuthority: source.sourceAuthority ?? source.publisher,
    sourceCategory: source.sourceCategory,
    adminCategory: metadataString(sourceMetadata, 'adminCategory'),
    jurisdiction: source.jurisdiction,
    stateOrTerritory: source.stateOrTerritory,
    pathwayCategory: source.pathwayCategory,
    legalDomain: source.legalDomain,
    topic: source.topic,
    sourceType: source.sourceType,
    sourceReliability: source.sourceReliability,
    status: source.status,
    active: source.active,
    legalReviewed: source.legalReviewed,
    officialUrl: source.officialUrl ?? source.url,
    citationUrl: source.officialUrl ?? source.url,
    legislationName:
      source.legislationName ??
      metadataString(chunkMetadata, 'actName') ??
      metadataString(sourceMetadata, 'actName') ??
      source.title,
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
    chunkIndex: chunk.chunkIndex,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    pineconeIndex: getPineconeIndexName(),
    pineconeNamespace: getPineconeNamespace()
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
        'metadata.pineconeIndexed': !update.indexingError && indexedChunkCount === chunkCount,
        'metadata.pineconeVectorCount': indexedChunkCount,
        'metadata.mongoChunkCount': chunkCount,
        'metadata.lastIndexedAt': update.indexedAt,
        'metadata.indexSyncStatus': update.indexingError
          ? partiallyIndexed
            ? 'partial'
            : 'failed'
          : indexedChunkCount === chunkCount
            ? 'synced'
            : 'pending',
        'metadata.indexSyncError': update.indexingError,
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
              pineconeVectorId: buildPineconeVectorId(source._id.toString(), chunk._id.toString()),
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

const syncSourceChunksForRetrieval = async (
  source: HydratedRagKnowledgeSourceDocument
): Promise<void> => {
  await RagChunkModel.updateMany(
    { sourceId: source._id },
    {
      $set: {
        legalReviewed: source.legalReviewed,
        active: source.active,
        'metadata.legalReviewed': source.legalReviewed,
        'metadata.active': source.active
      }
    }
  );

  if (!shouldUsePineconeProvider() || !isPineconeConfigured()) {
    return;
  }

  const chunks = await RagChunkModel.find({ sourceId: source._id, active: true })
    .select('_id sourceId sectionRef chunkIndex metadata embedding')
    .lean<PineconeIndexableChunk[]>();

  if (chunks.length === 0) {
    return;
  }

  await upsertChunksToPinecone(source, chunks);
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
      },
      pineconeIndexed: false,
      pineconeVectorCount: 0,
      mongoChunkCount: chunks.length,
      lastIndexedAt: undefined,
      indexSyncStatus: shouldUsePineconeProvider() ? 'pending' : 'synced',
      indexSyncError: undefined
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
  const verificationDate = options.verificationDate ?? new Date();

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
        sourceTitle: source.sourceTitle ?? source.title,
        sourceCategory: source.sourceCategory,
        sourceAuthority: source.sourceAuthority ?? source.publisher,
        officialUrl: source.officialUrl ?? source.url,
        country: source.country,
        jurisdiction: source.jurisdiction,
        stateOrTerritory: source.stateOrTerritory,
        pathwayCategory: source.pathwayCategory,
        legalDomain: source.legalDomain,
        topic: source.topic,
        legislationName:
          source.legislationName ??
          metadataString(sourceMetadata, 'actName') ??
          metadataStringArray(sourceMetadata, 'detectedActNames')[0] ??
          source.title,
        sourceType: source.sourceType,
        sectionRef: chunk.sectionRef,
        sectionNumber: chunk.sectionNumber,
        sectionTitle: chunk.sectionHeading,
        chunkIndex: chunk.index,
        chunkText: chunk.text,
        chunkHash: hashText(chunk.text),
        embedding: embeddings[index],
        embeddingModel: env.OPENAI_EMBEDDING_MODEL,
        pineconeIndex: shouldUsePineconeProvider() ? getPineconeIndexName() : undefined,
        pineconeNamespace: shouldUsePineconeProvider() ? getPineconeNamespace() : undefined,
        legalReviewed: source.legalReviewed,
        active: source.active,
        extractionMethod: source.extractionMethod ?? 'text',
        pageNumber: chunk.pageStart,
        ocrConfidence:
          source.extractionMethod === 'ocr' ? source.ocrAverageConfidence : undefined,
        ocrProvider: source.ocrProvider,
        tokenCount: chunk.tokenCount,
        citationLabel: chunk.citationLabel,
        citationUrl: source.officialUrl ?? source.url,
        metadata: {
          ...sourceMetadata,
          sourceTitle: source.title,
          sourceAuthority: source.sourceAuthority ?? source.publisher,
          sourceType: source.sourceType,
          sourceCategory: source.sourceCategory,
          officialUrl: source.officialUrl ?? source.url,
          country: source.country,
          language: source.language,
          jurisdiction: source.jurisdiction,
          stateOrTerritory: source.stateOrTerritory,
          pathwayCategory: source.pathwayCategory,
          legalDomain: source.legalDomain,
          legislationName:
            source.legislationName ??
            metadataString(sourceMetadata, 'actName') ??
            metadataStringArray(sourceMetadata, 'detectedActNames')[0] ??
            source.title,
          sourceReliability: source.sourceReliability,
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
          extractionMethod: source.extractionMethod ?? 'text',
          pageNumber: chunk.pageStart,
          ocrConfidence:
            source.extractionMethod === 'ocr' ? source.ocrAverageConfidence : undefined,
          ocrProvider: source.ocrProvider,
          constitutionalBasis: metadataString(sourceMetadata, 'constitutionalBasis'),
          legislationTags: metadataStringArray(sourceMetadata, 'legislationTags'),
          embeddingStatus: shouldUsePineconeProvider() ? ('pending' as const) : ('indexed' as const),
          pineconeIndexed: false,
          embeddingModel: env.OPENAI_EMBEDDING_MODEL,
          pineconeIndex: shouldUsePineconeProvider() ? getPineconeIndexName() : undefined,
          pineconeNamespace: shouldUsePineconeProvider() ? getPineconeNamespace() : undefined,
          embeddingCreatedAt: verificationDate.toISOString()
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
  source.embeddingModel = env.OPENAI_EMBEDDING_MODEL;
  source.pineconeIndex =
    shouldUsePineconeProvider() && isPineconeConfigured() ? getPineconeIndexName() : undefined;
  source.pineconeNamespace =
    shouldUsePineconeProvider() && isPineconeConfigured() ? getPineconeNamespace() : undefined;
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

  if (shouldUsePineconeProvider() && isPineconeConfigured()) {
    await pineconeVectorStore.deleteBySource(source._id.toString());
  }

  const savedChunks = await RagChunkModel.find({ sourceId: source._id }).sort({ chunkIndex: 1 });
  const pineconeIndexing =
    shouldUsePineconeProvider() && isPineconeConfigured()
      ? await upsertChunksToPinecone(source, savedChunks)
      : { indexedChunkCount: savedChunks.length, indexedAt: verificationDate.toISOString() };
  const indexingFailed = Boolean(pineconeIndexing.indexingError);
  const partiallyIndexed = indexingFailed && pineconeIndexing.indexedChunkCount > 0;
  const searchableAt = indexingFailed ? undefined : getSearchableAt(verificationDate);
  const preserveOcrReviewStatus =
    !indexingFailed &&
    source.extractionMethod === 'ocr' &&
    (source.ocrReviewRequired || source.ocrStatus === 'reviewed');
  source.ingestionStatus = partiallyIndexed
    ? 'partial_index_failed'
    : indexingFailed
      ? 'failed'
      : preserveOcrReviewStatus
        ? source.ocrReviewRequired
          ? 'pending_ocr_review'
          : 'ocr_completed'
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
      pineconeIndexed:
        shouldUsePineconeProvider() && isPineconeConfigured()
          ? pineconeIndexing.indexedChunkCount === embeddedChunks.length && !indexingFailed
          : false,
      pineconeVectorCount:
        shouldUsePineconeProvider() && isPineconeConfigured()
          ? pineconeIndexing.indexedChunkCount
          : 0,
      mongoChunkCount: embeddedChunks.length,
      lastIndexedAt: pineconeIndexing.indexedAt,
      indexSyncStatus:
        shouldUsePineconeProvider() && isPineconeConfigured()
          ? indexingFailed
            ? partiallyIndexed
              ? 'partial'
              : 'failed'
            : 'synced'
          : 'synced',
      indexSyncError: pineconeIndexing.indexingError,
      pineconeIndexedAt: pineconeIndexing.indexedAt,
      pineconeNamespace:
        shouldUsePineconeProvider() && isPineconeConfigured() ? getPineconeNamespace() : undefined,
      pineconeIndexName:
        shouldUsePineconeProvider() && isPineconeConfigured() ? getPineconeIndexName() : undefined,
      pineconeIndex:
        shouldUsePineconeProvider() && isPineconeConfigured() ? getPineconeIndexName() : undefined,
      indexingError: pineconeIndexing.indexingError,
      extractionStatus: 'extracted',
      extractionMethod: source.extractionMethod ?? metadataString(sourceMetadata, 'extractionMethod') ?? 'text',
      ocrProvider: source.ocrProvider,
      ocrAverageConfidence: source.ocrAverageConfidence,
      ocrPageCount: source.ocrPageCount,
      ocrWarnings: source.ocrWarnings,
      ocrReviewRequired: source.ocrReviewRequired,
      ocrReviewedAt: source.ocrReviewedAt?.toISOString(),
      ocrReviewedBy: source.ocrReviewedBy?.toString(),
      ocrStatus: source.ocrStatus ?? 'not_required',
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
  const derivedFields = buildDerivedSourceFields(normalizedInput);

  const source = await RagKnowledgeSourceModel.create({
    ...normalizedInput,
    ...derivedFields,
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
  const derivedFields = buildDerivedSourceFields({
    title: normalizedInput.title ?? source.title,
    sourceTitle: normalizedInput.sourceTitle ?? source.sourceTitle,
    publisher: normalizedInput.publisher ?? source.publisher,
    sourceAuthority: normalizedInput.sourceAuthority ?? source.sourceAuthority,
    url: normalizedInput.url ?? source.url,
    officialUrl: normalizedInput.officialUrl ?? source.officialUrl,
    jurisdiction: normalizedInput.jurisdiction ?? source.jurisdiction,
    sourceCategory: normalizedInput.sourceCategory ?? source.sourceCategory,
    topic: normalizedInput.topic ?? source.topic,
    legalDomain: normalizedInput.legalDomain ?? source.legalDomain,
    pathwayCategory: normalizedInput.pathwayCategory ?? source.pathwayCategory,
    stateOrTerritory: normalizedInput.stateOrTerritory ?? source.stateOrTerritory,
    sourceReliability: normalizedInput.sourceReliability ?? source.sourceReliability
  });

  const shouldReturnToReview =
    source.status === 'approved' &&
    hasMaterialReviewChange(normalizedInput) &&
    normalizedInput.status === undefined;
  const legalReviewedChanged =
    normalizedInput.legalReviewed !== undefined &&
    normalizedInput.legalReviewed !== source.legalReviewed;

  source.set({
    ...normalizedInput,
    ...derivedFields
  });

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

  if (legalReviewedChanged && source.ingestionStatus === 'embedded') {
    await syncSourceChunksForRetrieval(source);
  }

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

  if (shouldUsePineconeProvider() && isPineconeConfigured()) {
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
    let extracted = await extractTextFromUploadedDocument(file);
    const requiresOcr = shouldRequireOcr({
      text: extracted.text,
      extractor: extracted.extractor,
      mimeType: file.mimetype,
      fileName: file.originalname
    });

    if (requiresOcr) {
      source.ingestionStatus = 'requires_ocr';
      source.ingestionError =
        'Extracted document text quality was too low for safe indexing. OCR is required before ingestion.';
      source.metadata = withSearchReadiness({
        ...toMetadataRecord(source.metadata),
        uploadedFile: documentMetadata,
        extractedPageCount: extracted.pageCount,
        extractionMethod: extracted.extractionMethod,
        extractionQualityScore: extracted.qualityScore,
        extractionStatus: 'requires_ocr',
        ocrStatus: 'required',
        processingStage: 'requires_ocr',
        processingError: source.ingestionError,
        ingestionPipeline: {
          status: 'requires_ocr',
          extractor: extracted.extractor,
          updatedAt: new Date().toISOString(),
          error: source.ingestionError
        }
      }, 'not_indexed');
      await source.save();

      return {
        source: serializeKnowledgeSourceForAdmin(source.toObject()),
        uploadedFile: documentMetadata,
        ingestionStatus: source.ingestionStatus,
        warning: source.ingestionError
      };
    }

    if (
      env.RAG_ENABLE_OCR &&
      shouldRequireOcrForExtraction({
        text: extracted.text,
        extractor: extracted.extractor,
        mimeType: file.mimetype,
        fileName: file.originalname
      })
    ) {
      extracted = await runOcrForStoredDocument(source);
      const assessment = assessOcrOutputQuality({
        text: extracted.text,
        pageCount: extracted.pageCount ?? 0,
        pages: extracted.pages ?? [],
        averageConfidence: extracted.ocrAverageConfidence ?? 0,
        provider: (extracted.ocrProvider as RagOcrExtractResult['provider']) ?? 'tesseract',
        language: env.OCR_LANGUAGE,
        extractionMethod: 'ocr',
        warnings: extracted.ocrWarnings ?? []
      });

      if (!assessment.passed) {
        source.ingestionStatus = assessment.status === 'failed' ? 'ocr_failed' : 'ocr_low_confidence';
        source.ingestionError = assessment.reason ?? 'OCR output did not meet SafeSpeak quality thresholds.';
        source.metadata = withSearchReadiness(
          {
            ...toMetadataRecord(source.metadata),
            uploadedFile: documentMetadata,
            ...buildOcrMetadata(extracted, assessment, {
              reviewRequired: getOcrReviewRequired(source)
            }),
            extractionStatus: source.ingestionStatus,
            processingStage: source.ingestionStatus,
            processingError: source.ingestionError,
            ingestionPipeline: {
              status: source.ingestionStatus,
              extractor: extracted.extractor,
              updatedAt: new Date().toISOString(),
              error: source.ingestionError
            }
          },
          'not_indexed'
        );
        source.extractionMethod = 'ocr';
        source.ocrProvider = extracted.ocrProvider;
        source.ocrAverageConfidence = extracted.ocrAverageConfidence;
        source.ocrPageCount = extracted.pageCount;
        source.ocrWarnings = assessment.warnings;
        source.ocrReviewRequired = getOcrReviewRequired(source);
        source.ocrStatus = assessment.status;
        await source.save();

        return {
          source: serializeKnowledgeSourceForAdmin(source.toObject()),
          uploadedFile: documentMetadata,
          ingestionStatus: source.ingestionStatus,
          warning: source.ingestionError
        };
      }
    }

    if (extracted.text.length < OFFICIAL_REFRESH_MIN_TEXT_LENGTH) {
      throw new ApiError(
        StatusCodes.UNPROCESSABLE_ENTITY,
        'Extracted document text was too short to index safely.'
      );
    }

    const autoReviewOcr =
      extracted.extractionMethod === 'ocr' && shouldAutoReviewOcrForAdmin(context);
    const ocrReviewedAt = autoReviewOcr ? new Date() : undefined;
    const ocrReviewedBy = autoReviewOcr ? context.owner.userId : undefined;
    const ocrReviewRequired =
      extracted.extractionMethod === 'ocr'
        ? getOcrReviewRequired(source, { autoReview: autoReviewOcr })
        : false;
    const postOcrIngestionStatus = extracted.extractionMethod === 'ocr'
      ? ocrReviewRequired
        ? 'pending_ocr_review'
        : 'embedded'
      : 'embedded';

    if (
      extracted.extractionMethod === 'ocr' &&
      source.sourceCategory === 'official_legal_source' &&
      !autoReviewOcr
    ) {
      clearLegalReviewState(source);
    }

    const result = await embedKnowledgeSourceText(source, extracted.text, {
      metadata: {
        uploadedFile: documentMetadata,
        extractedPageCount: extracted.pageCount,
        extractionMethod: extracted.extractionMethod,
        extractionQualityScore: extracted.qualityScore,
        extractionStatus: 'extracted',
        ...(
          extracted.extractionMethod === 'ocr'
            ? buildOcrMetadata(extracted, {
                passed: true,
                status: ocrReviewRequired ? 'completed' : 'reviewed',
                warnings: extracted.ocrWarnings ?? [],
                failedPageCount: 0,
                garbageLikely: false
              }, {
                reviewRequired: ocrReviewRequired,
                reviewedAt: ocrReviewedAt?.toISOString(),
                reviewedBy: ocrReviewedBy
              })
            : {}
        ),
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
    source.extractionMethod = extracted.extractionMethod;
    source.ocrProvider = extracted.ocrProvider;
    source.ocrAverageConfidence = extracted.ocrAverageConfidence;
    source.ocrPageCount = extracted.pageCount;
    source.ocrWarnings = extracted.ocrWarnings;
    source.ocrReviewedAt = ocrReviewedAt;
    source.ocrReviewedBy = ocrReviewedBy as never;
    source.ocrReviewRequired = ocrReviewRequired;
    source.ocrStatus =
      extracted.extractionMethod === 'ocr'
        ? ocrReviewRequired
          ? 'completed'
          : 'reviewed'
        : 'not_required';
    source.ingestionStatus = postOcrIngestionStatus;
    await source.save();

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      mode: 'admin_document_upload',
      fileName: file.originalname,
      fileSizeBytes: file.size,
      extractor: extracted.extractor,
      extractionMethod: extracted.extractionMethod,
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
    source.ingestionStatus =
      error instanceof ApiError && /OCR/i.test(error.message) ? 'ocr_failed' : 'failed';
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
    if (
      shouldRequireOcr({
        text: resolvedText.text,
        extractor:
          metadataString(toMetadataRecord(resolvedText.metadata), 'extractor') ?? 'plain-text',
        mimeType: resolvedText.contentType
      })
    ) {
      source.ingestionStatus = 'requires_ocr';
      source.ingestionError =
        'Extracted document text quality was too low for safe indexing. OCR is required before ingestion.';
      source.metadata = withSearchReadiness({
        ...toMetadataRecord(source.metadata),
        ...toMetadataRecord(normalizedMetadata),
        ...toMetadataRecord(resolvedText.metadata),
        extractionStatus: 'requires_ocr',
        ocrStatus: 'required',
        processingStage: 'requires_ocr',
        processingError: source.ingestionError
      }, 'not_indexed');
      await source.save();

      return {
        source: serializeKnowledgeSourceForAdmin(source.toObject()),
        chunkCount: 0,
        metadataOnly: true,
        ingestionStatus: source.ingestionStatus,
        warning: source.ingestionError
      };
    }

    const resolvedExtracted = resolvedText.extracted;
    const autoReviewOcr =
      resolvedExtracted?.extractionMethod === 'ocr' && shouldAutoReviewOcrForAdmin(context);
    const ocrReviewedAt = autoReviewOcr ? new Date() : undefined;
    const ocrReviewedBy = autoReviewOcr ? context.owner.userId : undefined;
    const ocrReviewRequired =
      resolvedExtracted?.extractionMethod === 'ocr'
        ? getOcrReviewRequired(source, { autoReview: autoReviewOcr })
        : false;

    if (resolvedExtracted?.extractionMethod === 'ocr') {
      const ocrAssessment = assessOcrOutputQuality({
        text: resolvedExtracted.text,
        pageCount: resolvedExtracted.pageCount ?? 0,
        pages: resolvedExtracted.pages ?? [],
        averageConfidence: resolvedExtracted.ocrAverageConfidence ?? 0,
        provider: (resolvedExtracted.ocrProvider as RagOcrExtractResult['provider']) ?? 'tesseract',
        language: env.OCR_LANGUAGE,
        extractionMethod: 'ocr',
        warnings: resolvedExtracted.ocrWarnings ?? []
      });

      if (!ocrAssessment.passed) {
        source.ingestionStatus =
          ocrAssessment.status === 'failed' ? 'ocr_failed' : 'ocr_low_confidence';
        source.ingestionError =
          ocrAssessment.reason ?? 'OCR output did not meet SafeSpeak quality thresholds.';
        source.extractionMethod = 'ocr';
        source.ocrProvider = resolvedExtracted.ocrProvider;
        source.ocrAverageConfidence = resolvedExtracted.ocrAverageConfidence;
        source.ocrPageCount = resolvedExtracted.pageCount;
        source.ocrWarnings = ocrAssessment.warnings;
        source.ocrReviewRequired = getOcrReviewRequired(source);
        source.ocrStatus = ocrAssessment.status;
        source.metadata = withSearchReadiness(
          {
            ...toMetadataRecord(source.metadata),
            ...toMetadataRecord(normalizedMetadata),
            ...toMetadataRecord(resolvedText.metadata),
            ...buildOcrMetadata(resolvedExtracted, ocrAssessment, {
              reviewRequired: getOcrReviewRequired(source, { autoReview: autoReviewOcr })
            }),
            extractionStatus: source.ingestionStatus,
            processingStage: source.ingestionStatus,
            processingError: source.ingestionError
          },
          'not_indexed'
        );
        await source.save();

        return {
          source: serializeKnowledgeSourceForAdmin(source.toObject()),
          chunkCount: 0,
          metadataOnly: true,
          ingestionStatus: source.ingestionStatus,
          warning: source.ingestionError
        };
      }
    }

    if (resolvedText.text.length < OFFICIAL_REFRESH_MIN_TEXT_LENGTH) {
      throw new ApiError(
        StatusCodes.UNPROCESSABLE_ENTITY,
        'Extracted document text was too short to index safely.'
      );
    }

    if (
      resolvedExtracted?.extractionMethod === 'ocr' &&
      source.sourceCategory === 'official_legal_source' &&
      !autoReviewOcr
    ) {
      clearLegalReviewState(source);
    }

    const result = await embedKnowledgeSourceText(source, resolvedText.text, {
      expectedSha256: input.expectedSha256,
      metadata: {
        ...toMetadataRecord(normalizedMetadata),
        ...toMetadataRecord(resolvedText.metadata),
        ...(resolvedExtracted?.extractionMethod === 'ocr'
          ? buildOcrMetadata(resolvedExtracted, {
              passed: true,
              status: ocrReviewRequired ? 'completed' : 'reviewed',
              warnings: resolvedExtracted.ocrWarnings ?? [],
              failedPageCount: 0,
              garbageLikely: false
            }, {
              reviewRequired: ocrReviewRequired,
              reviewedAt: ocrReviewedAt?.toISOString(),
              reviewedBy: ocrReviewedBy
            })
          : {})
      },
      refreshMode: 'admin_ingest',
      contentType: resolvedText.contentType,
      contentLength: resolvedText.contentLength
    });
    source.extractionMethod = resolvedExtracted?.extractionMethod ?? 'manual';
    source.ocrProvider = resolvedExtracted?.ocrProvider;
    source.ocrAverageConfidence = resolvedExtracted?.ocrAverageConfidence;
    source.ocrPageCount = resolvedExtracted?.pageCount;
    source.ocrWarnings = resolvedExtracted?.ocrWarnings;
    source.ocrReviewedAt = ocrReviewedAt;
    source.ocrReviewedBy = ocrReviewedBy as never;
    source.ocrReviewRequired = ocrReviewRequired;
    source.ocrStatus =
      resolvedExtracted?.extractionMethod === 'ocr'
        ? ocrReviewRequired
          ? 'completed'
          : 'reviewed'
        : 'not_required';
    source.ingestionStatus =
      resolvedExtracted?.extractionMethod === 'ocr'
        ? ocrReviewRequired
          ? 'pending_ocr_review'
          : 'embedded'
        : 'embedded';
    await source.save();

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      chunkCount: result.chunkCount,
      sha256Hash: result.sha256Hash,
      extractionMethod: resolvedExtracted?.extractionMethod ?? 'manual',
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
    source.ingestionStatus =
      error instanceof ApiError && /OCR/i.test(error.message) ? 'ocr_failed' : 'failed';
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

  const isAdminDirectApproval = context.actorType === 'admin' && Boolean(context.owner.userId);
  const approvalBlocker = isAdminDirectApproval ? undefined : getKnowledgeSourceApprovalBlocker(source);

  if (approvalBlocker) {
    throw new ApiError(approvalBlocker.statusCode, approvalBlocker.message);
  }

  if (isAdminDirectApproval && source.sourceCategory === 'official_legal_source' && !source.legalReviewed) {
    source.legalReviewed = true;
    source.legalReviewedAt = new Date();
    source.legalReviewedBy = context.owner.userId as never;
  }
  const shouldSyncChunksForApproval =
    source.sourceCategory === 'official_legal_source' &&
    source.ingestionStatus === 'embedded' &&
    source.legalReviewed;

  if (isAdminDirectApproval && source.ocrReviewRequired) {
    source.ocrReviewRequired = false;
    source.ocrReviewedAt = new Date();
    source.ocrReviewedBy = context.owner.userId as never;
    source.ocrStatus = 'reviewed';
  }

  source.status = 'approved';
  source.approvedBy = context.owner.userId as never;
  source.approvedAt = new Date();
  source.lastVerifiedAt = new Date();
  if (source.ingestionStatus === 'embedded') {
    source.ingestionError = undefined;
  }
  await source.save();

  if (shouldSyncChunksForApproval) {
    await syncSourceChunksForRetrieval(source);
  }

  await auditRagAction(context, RAG_ACTIONS.sourceApprove, source._id.toString());

  return serializeKnowledgeSourceForAdmin(source.toObject());
};

export const runKnowledgeSourceOcr = async (
  context: RagServiceContext,
  sourceId: string,
  input?: {
    maxPages?: number;
    batchSize?: number;
    pageTimeoutMs?: number;
    jobTimeoutMs?: number;
    force?: boolean;
  }
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  const runtimeOptions = normalizeOcrExecutionOptions(input);
  const autoReviewOcr = shouldAutoReviewOcrForAdmin(context);
  const reviewRequired = getOcrReviewRequired(source, { autoReview: autoReviewOcr });

  if (
    !input?.force &&
    source.extractionMethod === 'ocr' &&
    ['completed', 'pending_review', 'reviewed'].includes(source.ocrStatus ?? '')
  ) {
    return {
      source: serializeKnowledgeSourceForAdmin(source.toObject()),
      skipped: true,
      message: 'OCR has already been completed for this source. Use force=true to rerun OCR.'
    };
  }

  if (input?.force) {
    await clearSourceIndexArtifacts(source);
  }

  const progressStartedAt = new Date().toISOString();
  source.extractionMethod = 'ocr';
  source.ocrReviewRequired = reviewRequired;
  source.ocrReviewedAt = undefined;
  source.ocrReviewedBy = undefined;
  source.ocrStatus = 'running';
  source.ingestionStatus = 'fetched';
  source.ingestionError = undefined;
  source.metadata = withSearchReadiness(
    {
      ...toMetadataRecord(source.metadata),
      ocrStatus: 'running',
      ocrProgress: {
        totalPages: 0,
        processedPages: 0,
        completedPages: 0,
        failedPages: 0,
        lowConfidencePages: 0,
        startedAt: progressStartedAt,
        updatedAt: progressStartedAt
      },
      processingStage: 'ocr_running',
      processingError: undefined
    },
    'indexing'
  );
  await source.save();

  try {
    const extracted = await runOcrForStoredDocument(source, {
      ...runtimeOptions,
      onProgress: async (progress, partialExtracted) => {
        const existingMetadata = toMetadataRecord(source.metadata);
        const existingPages = Array.isArray(existingMetadata.ocrPages) ? existingMetadata.ocrPages : [];
        const newPage = partialExtracted?.pages?.[0];
        const mergedPages = newPage
          ? [
              ...existingPages.filter(
                (page) =>
                  !(
                    typeof page === 'object' &&
                    page !== null &&
                    'pageNumber' in page &&
                    (page as { pageNumber?: unknown }).pageNumber === newPage.pageNumber
                  )
              ),
              newPage
            ].sort(
              (left, right) =>
                Number(
                  typeof left === 'object' && left !== null && 'pageNumber' in left
                    ? (left as { pageNumber?: number }).pageNumber ?? 0
                    : 0
                ) -
                Number(
                  typeof right === 'object' && right !== null && 'pageNumber' in right
                    ? (right as { pageNumber?: number }).pageNumber ?? 0
                    : 0
                )
            )
          : existingPages;

        source.ocrStatus = 'running';
        source.ocrPageCount = progress.totalPages;
        source.metadata = withSearchReadiness(
          {
            ...existingMetadata,
            ocrStatus: 'running',
            ocrPageCount: progress.totalPages,
            ocrProgress: progress,
            ocrPages: mergedPages,
            processingStage: 'ocr_running',
            processingError: progress.lastError
          },
          'indexing'
        );
        await source.save();
      }
    });
    const ocrResult: RagOcrExtractResult = {
      text: extracted.text,
      pageCount: extracted.pageCount ?? 0,
      totalPages: extracted.totalPages,
      pages: extracted.pages ?? [],
      averageConfidence: extracted.ocrAverageConfidence ?? 0,
      provider: (extracted.ocrProvider as RagOcrExtractResult['provider']) ?? 'tesseract',
      language: env.OCR_LANGUAGE,
      extractionMethod: 'ocr',
      warnings: extracted.ocrWarnings ?? [],
      progress: extracted.ocrProgress
    };
    const assessment = assessOcrOutputQuality(ocrResult);

    source.ocrProvider = extracted.ocrProvider;
    source.ocrAverageConfidence = extracted.ocrAverageConfidence;
    source.ocrPageCount = extracted.totalPages ?? extracted.pageCount;
    source.ocrWarnings = assessment.warnings;
    source.ocrReviewRequired = reviewRequired;
    source.rawText = extracted.text;
    source.ocrStatus = assessment.passed ? (reviewRequired ? 'pending_review' : 'completed') : assessment.status;
    source.ingestionStatus = assessment.passed
      ? reviewRequired
        ? 'pending_ocr_review'
        : 'ocr_completed'
      : assessment.status === 'failed'
        ? 'ocr_failed'
        : 'ocr_low_confidence';
    source.ingestionError = assessment.reason;
    source.metadata = withSearchReadiness(
      {
        ...toMetadataRecord(source.metadata),
        ...buildOcrMetadata(
          {
            ...extracted,
            ocrProgress: extracted.ocrProgress
              ? {
                  ...extracted.ocrProgress,
                  completedAt: extracted.ocrProgress.completedAt ?? new Date().toISOString()
                }
              : extracted.ocrProgress
          },
          assessment,
          {
            reviewRequired
          }
        ),
        extractionStatus: source.ingestionStatus,
        processingStage: source.ingestionStatus,
        processingError: source.ingestionError,
        ingestionPipeline: {
          ...toMetadataRecord(toMetadataRecord(source.metadata).ingestionPipeline),
          status: source.ingestionStatus,
          extractor: extracted.extractor,
          updatedAt: new Date().toISOString(),
          error: source.ingestionError
        }
      },
      assessment.passed ? 'not_indexed' : 'failed'
    );

    if (source.sourceCategory === 'official_legal_source' && !autoReviewOcr) {
      clearLegalReviewState(source);
    }

    await source.save();

    if (assessment.passed && !reviewRequired) {
      await ingestKnowledgeSource(context, sourceId, {
        content: extracted.text,
        expectedSha256: source.sha256Hash,
        metadata: toMetadataRecord(source.metadata)
      });
    }

    await auditRagAction(context, RAG_ACTIONS.sourceIngest, source._id.toString(), {
      mode: 'admin_run_ocr',
      extractionMethod: 'ocr',
      ocrProvider: source.ocrProvider,
      ocrAverageConfidence: source.ocrAverageConfidence,
      ocrStatus: source.ocrStatus,
      force: Boolean(input?.force)
    });

    return {
      source: serializeKnowledgeSourceForAdmin((await getSource(sourceId)).toObject()),
      pageCount: extracted.pageCount ?? 0,
      totalPages: extracted.totalPages ?? extracted.pageCount ?? 0,
      averageConfidence: extracted.ocrAverageConfidence ?? 0,
      warnings: assessment.warnings,
      passed: assessment.passed,
      ingestionStatus: source.ingestionStatus
    };
  } catch (error) {
    source.ocrStatus = 'failed';
    source.ingestionStatus = 'ocr_failed';
    source.ingestionError = error instanceof Error ? error.message : 'OCR failed';
    source.metadata = withSearchReadiness(
      {
        ...toMetadataRecord(source.metadata),
        ocrStatus: 'failed',
        ocrProgress: {
          ...toMetadataRecord(toMetadataRecord(source.metadata).ocrProgress),
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          lastError: source.ingestionError
        },
        processingStage: 'ocr_failed',
        processingError: source.ingestionError
      },
      'failed'
    );
    await source.save();
    throw error;
  }
};

export const approveOcrKnowledgeSource = async (
  context: RagServiceContext,
  sourceId: string,
  input: ApproveOcrKnowledgeSourceInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);

  if (source.extractionMethod !== 'ocr') {
    throw new ApiError(StatusCodes.CONFLICT, 'Knowledge source does not have OCR output to approve.');
  }

  if ((source.ocrAverageConfidence ?? 0) < env.OCR_MIN_CONFIDENCE) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'OCR confidence is below the configured threshold and cannot be approved for retrieval.'
    );
  }

  if (!source.rawText?.trim()) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Knowledge source does not have OCR text available to approve and reindex.'
    );
  }

  source.ocrReviewRequired = false;
  source.ocrReviewedAt = new Date();
  source.ocrReviewedBy = context.owner.userId as never;
  source.ocrStatus = 'reviewed';
  source.ingestionStatus = 'ocr_reviewed';
  source.ingestionError = undefined;
  source.metadata = withSearchReadiness(
    {
      ...toMetadataRecord(source.metadata),
      ocrReviewRequired: false,
      ocrReviewedAt: source.ocrReviewedAt.toISOString(),
      ocrReviewedBy: source.ocrReviewedBy ? String(source.ocrReviewedBy) : undefined,
      ocrStatus: 'reviewed',
      extractionStatus: 'ocr_reviewed',
      processingStage: 'ocr_reviewed',
      processingError: undefined
    },
    'searchable'
  );

  if (input.legalReviewed && source.sourceCategory === 'official_legal_source') {
    source.legalReviewed = true;
    source.legalReviewedAt = source.ocrReviewedAt;
    source.legalReviewedBy = context.owner.userId as never;
  }

  const result = await embedKnowledgeSourceText(source, source.rawText, {
    expectedSha256: source.sha256Hash,
    metadata: {
      ...toMetadataRecord(source.metadata),
      ocrReviewRequired: false,
      ocrReviewedAt: source.ocrReviewedAt.toISOString(),
      ocrReviewedBy: source.ocrReviewedBy ? String(source.ocrReviewedBy) : undefined,
      ocrStatus: 'reviewed',
      extractionStatus: 'ocr_reviewed',
      processingStage: 'indexed',
      processingError: undefined
    },
    refreshMode: 'ocr_review_approval'
  });

  const persistedSource = await getSource(sourceId);
  let needsSave = false;

  if (persistedSource.ocrReviewRequired || persistedSource.ocrStatus !== 'reviewed') {
    persistedSource.ocrReviewRequired = false;
    persistedSource.ocrStatus = 'reviewed';
    persistedSource.ocrReviewedAt = source.ocrReviewedAt;
    persistedSource.ocrReviewedBy = source.ocrReviewedBy;
    persistedSource.ingestionError = undefined;
    persistedSource.metadata = withSearchReadiness(
      {
        ...toMetadataRecord(persistedSource.metadata),
        ocrReviewRequired: false,
        ocrReviewedAt: persistedSource.ocrReviewedAt?.toISOString(),
        ocrReviewedBy: persistedSource.ocrReviewedBy ? String(persistedSource.ocrReviewedBy) : undefined,
        ocrStatus: 'reviewed',
        extractionStatus: persistedSource.ingestionStatus,
        processingError: undefined
      },
      'searchable'
    );
    needsSave = true;
  }

  if (
    input.legalReviewed &&
    persistedSource.sourceCategory === 'official_legal_source' &&
    !persistedSource.legalReviewed
  ) {
    persistedSource.legalReviewed = true;
    persistedSource.legalReviewedAt = source.ocrReviewedAt;
    persistedSource.legalReviewedBy = context.owner.userId as never;
    needsSave = true;
  }

  if (needsSave) {
    await persistedSource.save();
  }

  return {
    source: serializeKnowledgeSourceForAdmin(persistedSource.toObject()),
    result
  };
};

export const getKnowledgeSourceOcrPreview = async (
  context: RagServiceContext,
  sourceId: string,
  query: KnowledgeSourceOcrPreviewQueryInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);
  const metadata = toMetadataRecord(source.metadata);
  const pages = Array.isArray(metadata.ocrPages) ? metadata.ocrPages : [];
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 5;
  const paginated = paginateOcrPages(pages, page, pageSize);

  return {
    sourceId: source._id.toString(),
    extractionMethod: source.extractionMethod,
    ocrProvider: source.ocrProvider,
    averageConfidence: source.ocrAverageConfidence,
    pageCount: source.ocrPageCount,
    warnings: source.ocrWarnings ?? [],
    status: source.ocrStatus,
    sampleText: source.rawText?.slice(0, KNOWLEDGE_SOURCE_ADMIN_TEXT_PREVIEW_CHARS) ?? '',
    page: paginated.page,
    pageSize: paginated.pageSize,
    totalPages: paginated.totalPages,
    pages: paginated.pages
  };
};

export const getKnowledgeSourceStatus = async (
  context: RagServiceContext,
  sourceId: string
): Promise<unknown> => {
  ownerFilter(context.owner);
  const source = await getSource(sourceId);

  return buildOcrStatusSummary(source);
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
        pineconeVectorId: undefined,
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

export const classifySourceCategory = (input: RagAnswerInput | RagSearchInput): RagSourceCategory => {
  if (input.sourceCategory) {
    return input.sourceCategory;
  }

  const q = ('question' in input ? input.question : input.query).toLowerCase();
  if (
    /\b(law|legal|legislation|act|rights|court|discrimination|racial abuse|racial hatred|vilification|harassment|employer|privacy act|personal information|privacy principles?|australian privacy principles|interference with privacy|what are my options|what section|which section|schedule\s+\d+|section\s+[0-9a-z])/i.test(
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

export const buildFocusedLegalSearchQuery = (query: string): string => {
  const trimmedQuery = collapseWhitespace(query).replace(/[?]+$/, '').trim();

  if (!trimmedQuery) {
    return query.trim();
  }

  const sectionTopicMatch = trimmedQuery.match(
    /\b(?:what|which)\s+section(?:\s+of\s+the\s+[^?]+?)?\s+(?:deals with|covers|defines|contains|mentions|addresses|relates to)\s+(.+)$/i
  );

  if (sectionTopicMatch?.[1]) {
    return collapseWhitespace(sectionTopicMatch[1]);
  }

  const definitionTopicMatch = trimmedQuery.match(
    /^(?:what\s+(?:is|are)|what\s+does|define|definition of|meaning of)\s+(.+)$/i
  );

  if (definitionTopicMatch?.[1]) {
    return collapseWhitespace(
      definitionTopicMatch[1]
        .replace(/\s+(?:under|in)\s+the\s+[^?]+$/i, '')
        .replace(/\s+according to\s+[^?]+$/i, '')
    );
  }

  return collapseWhitespace(
    trimmedQuery
      .replace(/^according to (?:the )?(?:uploaded )?[^,]+,\s*/i, '')
      .replace(/\baccording to the uploaded\b/gi, '')
      .replace(/\baccording to the\b/gi, '')
      .replace(/\bunder the [A-Z][A-Za-z0-9'’().,&/-]*(?:\s+[A-Z][A-Za-z0-9'’().,&/-]+){0,10}\b/g, '')
  );
};

const buildSearchEmbeddingQuery = (query: string, sourceCategory: RagSourceCategory): string => {
  if (sourceCategory !== 'official_legal_source') {
    return query;
  }

  const focusedQuery = buildFocusedLegalSearchQuery(query);

  return focusedQuery || query;
};

const computeLegalResultRank = (result: RagSearchResult, query: string): number => {
  const focusedQuery = buildFocusedLegalSearchQuery(query);
  const normalizedFocusedQuery = normalizeLegalSearchText(focusedQuery);
  const normalizedText = normalizeLegalSearchText(result.text);
  const normalizedLabel = normalizeLegalSearchText(buildLegalSearchLabel(result));
  const normalizedCorpus = `${normalizedLabel} ${normalizedText}`.trim();
  const explicitSections = extractExplicitSectionReferences(query);
  const resultSectionRef = normalizeSectionReferenceValue(result.sectionRef ?? '');
  const importantTerms = extractImportantLegalTerms(focusedQuery);
  const matchedTerms = importantTerms.filter((term) => normalizedCorpus.includes(term));
  let score = (result.score ?? 0) * 100;

  if (normalizedFocusedQuery && normalizedFocusedQuery.length >= 12) {
    if (normalizedLabel.includes(normalizedFocusedQuery)) {
      score += 36;
    }

    if (normalizedText.includes(normalizedFocusedQuery)) {
      score += 28;
    }

    if (normalizedText.includes(`${normalizedFocusedQuery} means`)) {
      score += 18;
    }

    if (normalizedText.startsWith(normalizedFocusedQuery)) {
      score += 12;
    }
  }

  if (importantTerms.length > 0) {
    score += matchedTerms.length * 5;

    if (matchedTerms.length === importantTerms.length) {
      score += 14;
    }
  }

  if (explicitSections.length > 0 && explicitSections.includes(resultSectionRef)) {
    score += 32;
  }

  if (looksLikeTableOfContentsChunk(result.text)) {
    score -= 18;
  }

  if (isLikelyLegislationRunningHeaderLine(result.text.split('\n')[0] ?? '')) {
    score -= 22;
  }

  return score;
};

const rerankLegalSearchResults = (results: RagSearchResult[], query: string): RagSearchResult[] =>
  [...results].sort(
    (left, right) => computeLegalResultRank(right, query) - computeLegalResultRank(left, query)
  );

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
    active: true,
    deletedAt: { $exists: false },
    ...(input.sourceIds?.length
      ? {
          _id: {
            $in: input.sourceIds.map((sourceId) => new Types.ObjectId(sourceId))
          }
        }
      : {}),
    sourceCategory: category,
    ...(category === 'official_legal_source' ? { legalReviewed: true } : {}),
    $and: [
      {
        $or: [
          { extractionMethod: { $ne: 'ocr' } },
          { ocrReviewRequired: false },
          { ocrStatus: 'reviewed' }
        ]
      },
      {
        $or: [
          { extractionMethod: { $ne: 'ocr' } },
          { ocrAverageConfidence: { $gte: env.OCR_MIN_CONFIDENCE } }
        ]
      }
    ],
    ...(input.language ? { language: input.language } : {}),
    ...buildJurisdictionFilter(input.jurisdiction, category),
    ...(input.stateOrTerritory ? { stateOrTerritory: input.stateOrTerritory } : {}),
    ...(input.legalDomain ? { legalDomain: input.legalDomain } : {}),
    ...(input.pathwayCategory ? { pathwayCategory: input.pathwayCategory } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
    ...(isGovernedKnowledgeSource(category)
      ? {
          nextRefreshAt: { $gt: now },
          $or: [{ nextReviewAt: { $exists: false } }, { nextReviewAt: { $gt: now } }]
        }
      : {})
  };
};

const getEffectiveTopK = (input: RagSearchInput, category: RagSourceCategory): number => {
  if (input.topK) {
    return input.topK;
  }

  return category === 'official_legal_source' ? env.RAG_TOP_K_LEGAL : env.RAG_TOP_K_SUPPORT;
};

const getMinimumScore = (category: RagSourceCategory): number =>
  category === 'official_legal_source' ? env.RAG_MIN_SCORE_LEGAL : env.RAG_MIN_SCORE_SUPPORT;

const suppressDuplicateAndWeakResults = (
  results: RagSearchResult[],
  category: RagSourceCategory
): RagSearchResult[] => {
  const minScore = getMinimumScore(category);
  const maxChunksPerSource = env.RAG_MAX_CHUNKS_PER_SOURCE;
  const seenSnippetKeys = new Set<string>();
  const countBySourceId = new Map<string, number>();

  return results.filter((result) => {
    if (typeof result.score === 'number' && result.score < minScore) {
      return false;
    }

    const snippetKey = `${result.sourceId}:${normalizeLegalSearchText(result.text).slice(0, 220)}`;
    if (seenSnippetKeys.has(snippetKey)) {
      return false;
    }

    const sourceCount = countBySourceId.get(result.sourceId) ?? 0;
    if (sourceCount >= maxChunksPerSource) {
      return false;
    }

    seenSnippetKeys.add(snippetKey);
    countBySourceId.set(result.sourceId, sourceCount + 1);
    return true;
  });
};

const searchRagWithPinecone = async (
  input: RagSearchInput,
  category: RagSourceCategory,
  sourceFilter: FilterQuery<RagKnowledgeSourceDocument>,
  queryVector: number[],
  sourceIds: unknown[]
): Promise<RagSearchResult[]> => {
  const requestedTopK = getEffectiveTopK(input, category);
  const candidateTopK =
    category === 'official_legal_source'
      ? Math.max(requestedTopK * PINECONE_SEARCH_CANDIDATE_MULTIPLIER, PINECONE_SEARCH_MIN_CANDIDATES)
      : Math.max(requestedTopK, DEFAULT_RAG_TOP_K);
  const vectorResults = await pineconeVectorStore.search({
    vector: queryVector,
    topK: candidateTopK,
      filters: {
        sourceCategory: category,
        jurisdiction: input.jurisdiction,
        stateOrTerritory: input.stateOrTerritory,
        topic: input.topic,
        legalDomain: input.legalDomain,
        pathwayCategory: input.pathwayCategory,
        active: true,
        legalReviewed: category === 'official_legal_source' ? true : undefined,
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
        sourceTitle: source.sourceTitle ?? source.title,
        publisher: source.publisher,
        sourceAuthority: source.sourceAuthority ?? source.publisher,
        sourceCategory: source.sourceCategory,
        sourceType: source.sourceType,
        jurisdiction: source.jurisdiction,
        stateOrTerritory: source.stateOrTerritory,
        pathwayCategory: source.pathwayCategory,
        legalDomain: source.legalDomain,
        topic: source.topic,
        legislationName: source.legislationName,
        sectionRef: chunk.sectionRef,
        sectionTitle: chunk.sectionTitle,
        citationUrl: chunk.citationUrl,
        lastUpdated: source.lastUpdated,
        text: chunk.chunkText,
        score: scoreByChunkId.get(chunk._id.toString()),
        extractionMethod: source.extractionMethod,
        ocrProvider: source.ocrProvider,
        ocrAverageConfidence: source.ocrAverageConfidence,
        ocrStatus: source.ocrStatus,
        metadata: chunk.metadata ?? {}
      });
  }

  const orderedResults = results
    .sort(
      (left, right) =>
        (orderByChunkId.get(left.chunkId) ?? Number.MAX_SAFE_INTEGER) -
        (orderByChunkId.get(right.chunkId) ?? Number.MAX_SAFE_INTEGER)
    );

  const rerankedResults =
    category === 'official_legal_source'
      ? rerankLegalSearchResults(orderedResults, input.query)
      : orderedResults;

  return suppressDuplicateAndWeakResults(rerankedResults, category).slice(0, requestedTopK);
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
      answer:
        'If you are in immediate danger in Australia, call 000 now. If it is safe, you can contact 1800RESPECT.',
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

  const searchQuery = buildSearchEmbeddingQuery(input.query, sourceCategory);
  const queryVector = await createEmbedding(searchQuery);
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

  if (shouldUsePineconeProvider() && isPineconeConfigured() && !pineconeCoverageIncomplete) {
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
        topK: getEffectiveTopK(input, sourceCategory),
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
  } else if (shouldUsePineconeProvider() && isPineconeConfigured() && pineconeCoverageIncomplete) {
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

  if (!shouldAllowMongoFallback()) {
    return [];
  }

  const pipeline: PipelineStage[] = [
    {
      $vectorSearch: {
        index: env.RAG_VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(getEffectiveTopK(input, sourceCategory) * 10, 50),
        limit: getEffectiveTopK(input, sourceCategory),
        filter: {
          sourceId: { $in: sourceIds },
          sourceCategory,
          ...(input.stateOrTerritory ? { stateOrTerritory: input.stateOrTerritory } : {}),
          ...(input.legalDomain ? { legalDomain: input.legalDomain } : {}),
          ...(input.pathwayCategory ? { pathwayCategory: input.pathwayCategory } : {}),
          active: true
        }
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
        'source.sourceTitle': 1,
        'source.publisher': 1,
        'source.sourceAuthority': 1,
        'source.sourceCategory': 1,
        'source.sourceType': 1,
        'source.topic': 1,
        'source.jurisdiction': 1,
        'source.stateOrTerritory': 1,
        'source.pathwayCategory': 1,
        'source.legalDomain': 1,
        'source.legislationName': 1,
        'source.lastUpdated': 1,
        'source.extractionMethod': 1,
        'source.ocrProvider': 1,
        'source.ocrAverageConfidence': 1,
        'source.ocrStatus': 1
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
      sourceTitle?: string;
      publisher: string;
      sourceAuthority?: string;
      sourceCategory: RagSourceCategory;
      sourceType: RagSearchResult['sourceType'];
      topic: RagSearchResult['topic'];
      jurisdiction: RagSearchResult['jurisdiction'];
      stateOrTerritory?: RagStateOrTerritory;
      pathwayCategory?: RagPathwayCategory;
      legalDomain?: RagLegalDomain;
      legislationName?: string;
      lastUpdated?: Date;
      extractionMethod?: RagSearchResult['extractionMethod'];
      ocrProvider?: string;
      ocrAverageConfidence?: number;
      ocrStatus?: RagOcrStatus;
    };
  };
  const results = await RagChunkModel.aggregate<RagAggregateResult>(pipeline);
  await auditRagAction(context, RAG_ACTIONS.search, undefined, {
    resultCount: results.length,
    topK: input.topK ?? DEFAULT_RAG_TOP_K,
    vectorStore: 'mongo'
  });

  const mappedResults = results.map((result) => ({
    chunkId: result._id.toString(),
    sourceId: result.sourceId.toString(),
    title: result.source.title,
    sourceTitle: result.source.sourceTitle ?? result.source.title,
    publisher: result.source.publisher,
    sourceAuthority: result.source.sourceAuthority ?? result.source.publisher,
    sourceCategory: result.source.sourceCategory,
    sourceType: result.source.sourceType,
    jurisdiction: result.source.jurisdiction,
    stateOrTerritory: result.source.stateOrTerritory,
    pathwayCategory: result.source.pathwayCategory,
    legalDomain: result.source.legalDomain,
    topic: result.source.topic,
    legislationName: result.source.legislationName,
    sectionRef: result.sectionRef,
    sectionTitle: metadataString(result.metadata ?? {}, 'sectionHeading'),
    citationUrl: result.citationUrl,
    lastUpdated: result.source.lastUpdated,
    text: result.chunkText,
    score: result.score,
    extractionMethod: result.source.extractionMethod,
    ocrProvider: result.source.ocrProvider,
    ocrAverageConfidence: result.source.ocrAverageConfidence,
    ocrStatus: result.source.ocrStatus,
    metadata: result.metadata ?? {}
  }));

  const filteredResults = suppressDuplicateAndWeakResults(
    sourceCategory === 'official_legal_source'
      ? rerankLegalSearchResults(mappedResults, input.query)
      : mappedResults,
    sourceCategory
  );

  return filteredResults;
};

export const debugRetrieveRag = async (
  context: RagServiceContext,
  input: RagDebugRetrieveInput
): Promise<Record<string, unknown>> => {
  const sourceCategory = classifySourceCategory(input);
  const minScore = getMinimumScore(sourceCategory);
  const results = await searchRag(context, {
    ...input,
    sourceCategory,
    topK: input.topK
  });

  return {
    vectorProvider: env.RAG_VECTOR_PROVIDER,
    sourceCategory,
    threshold: minScore,
    topK: getEffectiveTopK(input, sourceCategory),
    results: results.map((result) => ({
      score: result.score ?? 0,
      passedThreshold: typeof result.score === 'number' ? result.score >= minScore : true,
      sourceTitle: result.sourceTitle,
      sourceAuthority: result.sourceAuthority,
      jurisdiction: result.jurisdiction,
      stateOrTerritory: result.stateOrTerritory,
      legalDomain: result.legalDomain,
      pathwayCategory: result.pathwayCategory,
      section: result.sectionTitle
        ? [result.sectionRef, result.sectionTitle].filter(Boolean).join(' - ')
        : result.sectionRef,
      snippet: result.text.slice(0, 500),
      metadata: result.metadata
    }))
  };
};

const buildRagContextEntry = (result: RagSearchResult, index: number): string => {
  const metadata = toMetadataRecord(result.metadata);
  const sectionHeading = metadataString(metadata, 'sectionHeading');
  const heading = [result.title, result.sectionRef, sectionHeading].filter(Boolean).join(' | ');

  return `[${index + 1}] ${heading || result.title}\n${result.text}`;
};

const buildRagContextText = (results: RagSearchResult[]): string =>
  results.map((result, index) => buildRagContextEntry(result, index)).join('\n\n');

const extractLeadingLegalHeadingText = (result: RagSearchResult): string | undefined => {
  const metadata = toMetadataRecord(result.metadata);
  const metadataHeading = metadataString(metadata, 'sectionHeading');
  const lines = result.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return metadataHeading;
  }

  const normalizedFirstLine = lines[0].replace(/^(?:section\s+)?[0-9A-Za-z().-]+\s+/i, '').trim();
  const secondLine =
    lines[1] &&
    !/^\(?[0-9]+[A-Za-z]?\)?/.test(lines[1]) &&
    !/^Authorised Version\b/i.test(lines[1]) &&
    !/^Compilation No\.\s*\d+/i.test(lines[1]) &&
    lines[1] !== normalizedFirstLine
      ? lines[1]
      : '';
  const combinedHeading = collapseWhitespace(
    [normalizedFirstLine, secondLine].filter(Boolean).join(' ')
  );

  return combinedHeading || metadataHeading;
};

const selectGroundedLegalResults = (results: RagSearchResult[], query: string): RagSearchResult[] => {
  const focusedQuery = buildFocusedLegalSearchQuery(query);
  const normalizedFocusedQuery = normalizeLegalSearchText(focusedQuery);
  const explicitSections = extractExplicitSectionReferences(query);
  const importantTerms = extractImportantLegalTerms(focusedQuery);
  const annotatedResults = results.map((result) => {
    const normalizedText = normalizeLegalSearchText(result.text);
    const normalizedLabel = normalizeLegalSearchText(buildLegalSearchLabel(result));
    const normalizedCorpus = `${normalizedLabel} ${normalizedText}`.trim();
    const matchedTerms = importantTerms.filter((term) => normalizedCorpus.includes(term));
    const resultSectionRef = normalizeSectionReferenceValue(result.sectionRef ?? '');
    const exactPhraseMatch =
      normalizedFocusedQuery.length >= 8 &&
      (normalizedLabel.includes(normalizedFocusedQuery) ||
        normalizedText.includes(normalizedFocusedQuery));
    const definitionMatch =
      normalizedFocusedQuery.length >= 8 &&
      normalizedText.includes(`${normalizedFocusedQuery} means`);
    const explicitSectionMatch =
      explicitSections.length > 0 && explicitSections.includes(resultSectionRef);
    const strongTermMatch =
      importantTerms.length > 0 &&
      matchedTerms.length >= Math.min(2, importantTerms.length) &&
      matchedTerms.length / importantTerms.length >= 0.6;

    return {
      result,
      explicitSectionMatch,
      definitionMatch,
      exactPhraseMatch,
      strongTermMatch
    };
  });

  if (annotatedResults.some((entry) => entry.definitionMatch)) {
    return annotatedResults
      .filter((entry) => entry.definitionMatch || entry.explicitSectionMatch)
      .map((entry) => entry.result)
      .slice(0, 4);
  }

  if (annotatedResults.some((entry) => entry.explicitSectionMatch)) {
    return annotatedResults
      .filter((entry) => entry.explicitSectionMatch || entry.exactPhraseMatch)
      .map((entry) => entry.result)
      .slice(0, 4);
  }

  if (annotatedResults.some((entry) => entry.exactPhraseMatch)) {
    return annotatedResults
      .filter((entry) => entry.exactPhraseMatch)
      .map((entry) => entry.result)
      .slice(0, 4);
  }

  const groundedResults = annotatedResults
    .filter((entry) => entry.strongTermMatch)
    .map((entry) => entry.result)
    .slice(0, 4);

  return groundedResults;
};

export const buildGroundedSectionAnswer = (
  question: string,
  results: RagSearchResult[]
): string | undefined => {
  if (!/\b(?:what|which)\s+section\b/i.test(question) || results.length === 0) {
    return undefined;
  }

  const topResult = results[0];

  if (!topResult.sectionRef) {
    return undefined;
  }

  const sectionRef = topResult.sectionRef.replace(/^Section\s+/i, 'section ');
  const focusedQuery = buildFocusedLegalSearchQuery(question);
  const sourceTitle = /^the\s+/i.test(topResult.title) ? topResult.title : `the ${topResult.title}`;
  const sectionSubject = focusedQuery || 'that issue';
  const heading = extractLeadingLegalHeadingText(topResult);
  const simpleTopic =
    heading && focusedQuery && !heading.toLowerCase().includes(focusedQuery.toLowerCase())
      ? collapseWhitespace(heading).replace(/\.\.+$/, '')
      : sectionSubject;

  return [
    `Yes — under ${sourceTitle}, ${sectionSubject} is dealt with in ${sectionRef}.`,
    `In simple terms, this section is about ${simpleTopic}.`,
    `I'm not making a legal decision for you, but this may be relevant if that issue affects your situation.`
  ].join('\n\n');
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildGroundedDefinitionAnswer = (
  question: string,
  results: RagSearchResult[]
): string | undefined => {
  if (results.length === 0 || /\b(?:what|which)\s+section\b/i.test(question)) {
    return undefined;
  }

  const focusedQuery = buildFocusedLegalSearchQuery(question);
  const topResult = results[0];

  if (!focusedQuery || !topResult?.sectionRef) {
    return undefined;
  }

  const definitionMatch = topResult.text.match(
    new RegExp(
      `${escapeRegExp(focusedQuery)}\\s+means\\s+([\\s\\S]+?)(?=\\nNote:|\\n[A-Za-z][A-Za-z'’().,&/-]+\\s+means|$)`,
      'i'
    )
  );
  const definitionText = definitionMatch?.[1] ? collapseWhitespace(definitionMatch[1]) : '';

  if (!definitionText) {
    return undefined;
  }

  const sectionRef = topResult.sectionRef.replace(/^Section\s+/i, 'section ');
  const normalizedDefinitionText = definitionText.replace(/\.\.+$/, '.');
  const sourceTitle = /^the\s+/i.test(topResult.title) ? topResult.title : `the ${topResult.title}`;

  return [
    `Under ${sourceTitle}, ${sectionRef} says ${focusedQuery.toLowerCase()} means ${normalizedDefinitionText}`,
    `In simple terms, this is the definition the source gives for that term.`
  ].join('\n\n');
};

export const buildGroundedLegalNotFoundAnswer = (
  question: string,
  rawTopTitle: string,
  focusedQuery: string
): string => {
  const sourceTitle = rawTopTitle || 'that legal source';
  const normalizedTitle = /^the\s+/i.test(sourceTitle) ? sourceTitle : `the ${sourceTitle}`;

  if (
    /\b(domestic violence|family violence)\b/i.test(question) &&
    /\b(prison|sentence|jail|gaol|imprison(?:ment|ed|ing)?)\b/i.test(question)
  ) {
    return [
      `I couldn't find anything in ${normalizedTitle} that sets a prison sentence for domestic violence.`,
      `That Act mainly deals with privacy, personal information, and privacy complaints, so this may not be the right source for that question.`,
      `If someone is in immediate danger, emergency or specialist family violence support is more appropriate.`
    ].join('\n\n');
  }

  return [
    `I couldn't find anything in ${normalizedTitle} that clearly answers that question.`,
    `This may mean that source does not cover ${focusedQuery || 'that issue'}, or that I need a more specific question to find the right section.`
  ].join('\n\n');
};

type AssistantSourceDisplayReason =
  | 'legal_lookup'
  | 'explicit_citation_request'
  | 'hidden_support_reply'
  | 'triage_handoff'
  | 'not_directly_grounded';

const looksLikeSourceBackedQuestion = (message: string): boolean => {
  const trimmedMessage = collapseWhitespace(message);

  return (
    /\b(according to|privacy act|what section|which section|section\s+[0-9a-z]|schedule\s+\d+|australian privacy principles|personal information|interference with privacy|serious interference with privacy|what law covers this|under the act|this act|that act|the act|uploaded source|covered by the legislation|can you cite the source|what does this act say)\b/i.test(
      trimmedMessage
    ) &&
    (/\?/.test(trimmedMessage) || trimmedMessage.split(' ').length <= 8)
  );
};

const looksLikeExplicitCitationRequest = (message: string): boolean =>
  /\b(cite|citation|source|according to the uploaded source|according to the source|which section|what section|under the act|uploaded privacy act|covered by the legislation)\b/i.test(
    collapseWhitespace(message)
  );

const hasRenderableUserCitation = (
  citation: Partial<{
    title: string;
    sectionRef: string;
    url: string;
  }>
): boolean => Boolean(citation.title && (citation.sectionRef || citation.url));

export const buildAssistantSourceDisplayMeta = (input: {
  message: string;
  citations: Array<
    Partial<{
      title: string;
      sectionRef: string;
      url: string;
    }>
  >;
  triageHandoff?: boolean;
}): {
  showSources: boolean;
  sourceDisplayReason: AssistantSourceDisplayReason;
} => {
  if (input.triageHandoff) {
    return {
      showSources: false,
      sourceDisplayReason: 'triage_handoff'
    };
  }

  const hasDirectCitations = input.citations.some(hasRenderableUserCitation);

  if (!hasDirectCitations) {
    return {
      showSources: false,
      sourceDisplayReason: 'not_directly_grounded'
    };
  }

  if (looksLikeExplicitCitationRequest(input.message)) {
    return {
      showSources: true,
      sourceDisplayReason: 'explicit_citation_request'
    };
  }

  if (looksLikeSourceBackedQuestion(input.message)) {
    return {
      showSources: true,
      sourceDisplayReason: 'legal_lookup'
    };
  }

  return {
    showSources: false,
    sourceDisplayReason: 'hidden_support_reply'
  };
};

export const answerRag = async (
  context: RagServiceContext,
  input: RagAnswerInput
): Promise<Record<string, unknown>> => {
  const category = classifySourceCategory(input);
  let results: RagSearchResult[] = [];
  let rawResultCount = 0;
  let rawTopTitle = '';
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
    rawResultCount = results.length;
    rawTopTitle = results[0]?.title ?? '';

    if (category === 'official_legal_source') {
      results = selectGroundedLegalResults(results, input.question);
    }
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
    if (category === 'official_legal_source' && rawResultCount > 0) {
      const focusedQuery = buildFocusedLegalSearchQuery(input.question).toLowerCase() || 'that topic';

      return {
        answer: buildGroundedLegalNotFoundAnswer(input.question, rawTopTitle, focusedQuery),
        disclaimer: buildInformationOnlyDisclaimer(),
        citations: [],
        showSources: false,
        sourceDisplayReason: 'not_directly_grounded',
        sourceCategoriesUsed: [],
        confidence: 'low',
        pendingHumanReview: true,
        safetyFlags: { crisisRisk, legalAdviceRisk, clinicalAdviceRisk, insufficientSources: true },
        legalAwareness
      };
    }

    return buildFallbackAnswer(
      input.question,
      category,
      { crisisRisk, legalAdviceRisk, clinicalAdviceRisk, insufficientSources },
      fallbackReason,
      legalAwareness
    );
  }

  const contextText = buildRagContextText(results);

  const modelResponse = await answerWithContext(context, {
    question: input.question,
    language: input.language,
    citations,
    contextText
  });

  const output = (modelResponse.output ?? {}) as Record<string, unknown>;
  const answerCandidate = output.answer ?? output.text;
  const deterministicAnswer =
    buildGroundedSectionAnswer(input.question, results) ??
    buildGroundedDefinitionAnswer(input.question, results);
  const answerText = enforceAiOutputGuardrails(
    deterministicAnswer ||
      (typeof answerCandidate === 'string'
        ? answerCandidate
        : JSON.stringify(answerCandidate ?? ''))
  );

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    citationCount: results.length,
    sourceCategory: category
  });

  const sourceDisplayMeta = buildAssistantSourceDisplayMeta({
    message: input.question,
    citations: results.map((result) => ({
      title: result.title,
      sectionRef: result.sectionRef,
      url: result.citationUrl
    }))
  });

  return {
    answer: answerText,
    disclaimer: buildInformationOnlyDisclaimer(),
    citations: results.map((result) => ({
      sourceId: result.sourceId,
      title: result.title,
      publisher: result.publisher,
      sourceAuthority: result.sourceAuthority,
      url: result.citationUrl,
      jurisdiction: result.jurisdiction,
      stateOrTerritory: result.stateOrTerritory,
      sourceCategory: result.sourceCategory,
      sourceType: result.sourceType,
      pathwayCategory: result.pathwayCategory,
      legalDomain: result.legalDomain,
      topic: result.topic,
      sectionRef: result.sectionRef,
      sectionTitle: result.sectionTitle,
      lastUpdated: result.lastUpdated
    })),
    showSources: sourceDisplayMeta.showSources,
    sourceDisplayReason: sourceDisplayMeta.sourceDisplayReason,
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

export const sanitizeTimelineAssistantModelInput = (
  input: RagTimelineAssistantInput
): {
  sanitizedInput: RagTimelineAssistantInput;
  encodingWarning: boolean;
  excludedConversationCount: number;
  excludedTimelineKeys: string[];
} => {
  const sanitizedConversation = input.conversation.filter(
    (entry) => !hasBrokenTextEncoding(entry.content)
  );
  const excludedConversationCount = input.conversation.length - sanitizedConversation.length;
  const excludedTimelineKeys: string[] = [];
  const sanitizedTimeline = Object.fromEntries(
    Object.entries(input.timeline).filter(([key, value]) => {
      const normalizedValue = typeof value === 'string' ? value : '';

      if (normalizedValue && hasBrokenTextEncoding(normalizedValue)) {
        excludedTimelineKeys.push(key);
        return false;
      }

      return true;
    })
  );

  return {
    sanitizedInput: {
      ...input,
      conversation: sanitizedConversation,
      timeline: sanitizedTimeline
    },
    encodingWarning: excludedConversationCount > 0 || excludedTimelineKeys.length > 0,
    excludedConversationCount,
    excludedTimelineKeys
  };
};

export const runTimelineAssistant = async (
  context: RagServiceContext,
  input: RagTimelineAssistantInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  if (hasBrokenTextEncoding(input.message)) {
    logger.info(
      {
        mode: 'timeline_assistant',
        latestUserMessageUnicodeEscaped: escapeUnicodeForLog(input.message),
        encodingWarning: true
      },
      'Timeline assistant encoding guard triggered'
    );

    return {
      assistantMessage: 'The message looks like it was received with broken text encoding. Please resend it.',
      nextQuestion: '',
      timeline: normalizeTimelineObject(input.timeline),
      readyForSubmission: false,
      confidence: 'low',
      disclaimer: buildInformationOnlyDisclaimer(),
      citations: [],
      showSources: false,
      sourceDisplayReason: 'hidden_support_reply',
      rag: {
        used: false,
        unavailable: false,
        resultCount: 0
      },
      reviewStatus: 'encoding_error',
      encodingWarning: true
    };
  }

  const timelineAssistantInput = sanitizeTimelineAssistantModelInput(input);
  const sanitizedInput = timelineAssistantInput.sanitizedInput;
  const resolvedLanguage = resolveAssistantLanguage({
    message: sanitizedInput.message,
    requestedLanguage: sanitizedInput.language
  });

  logger.info(
    {
      mode: 'timeline_assistant',
      latestUserMessageUnicodeEscaped: escapeUnicodeForLog(sanitizedInput.message),
      conversationPreviewUnicodeEscaped: sanitizedInput.conversation
        .slice(-3)
        .map((entry) => `${entry.role}:${escapeUnicodeForLog(entry.content.slice(0, 120))}`),
      excludedConversationCount: timelineAssistantInput.excludedConversationCount,
      excludedTimelineKeys: timelineAssistantInput.excludedTimelineKeys,
      encodingWarning: timelineAssistantInput.encodingWarning
    },
    'Timeline assistant request'
  );

  if (looksLikeSourceBackedQuestion(sanitizedInput.message)) {
    const groundedAnswer = await answerRag(context, {
      query: sanitizedInput.message,
      question: sanitizedInput.message,
      topK: sanitizedInput.topK,
      language: resolvedLanguage,
      jurisdiction: sanitizedInput.jurisdiction
    });

    return {
      assistantMessage:
        typeof groundedAnswer.answer === 'string' && groundedAnswer.answer.trim()
          ? enforceAiOutputGuardrails(groundedAnswer.answer)
          : 'I could not find that in the retrieved approved sources.',
      nextQuestion: '',
      timeline: normalizeTimelineObject(sanitizedInput.timeline),
      readyForSubmission: false,
      confidence: groundedAnswer.confidence ?? 'low',
      disclaimer: groundedAnswer.disclaimer ?? buildInformationOnlyDisclaimer(),
      citations: Array.isArray(groundedAnswer.citations) ? groundedAnswer.citations : [],
      showSources: Boolean(groundedAnswer.showSources),
      sourceDisplayReason:
        typeof groundedAnswer.sourceDisplayReason === 'string'
          ? groundedAnswer.sourceDisplayReason
          : 'not_directly_grounded',
      legalAwareness: groundedAnswer.legalAwareness,
      rag: {
        used: Array.isArray(groundedAnswer.citations) && groundedAnswer.citations.length > 0,
        unavailable: false,
        resultCount: Array.isArray(groundedAnswer.citations) ? groundedAnswer.citations.length : 0
      },
      reviewStatus: groundedAnswer.pendingHumanReview
        ? 'pending_human_review'
        : 'grounded_source_answer',
      encodingWarning: timelineAssistantInput.encodingWarning
    };
  }

  let results: RagSearchResult[] = [];
  let ragUnavailable = false;

  try {
    results = await searchTimelineRag(context, sanitizedInput);
  } catch {
    ragUnavailable = true;
  }

  const contextText = buildRagContextText(results);
  const citations: AiCitation[] = results.map((result) => ({
    sourceType: 'knowledge_source',
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.text.slice(0, 500)
  }));

  let modelResponse = await generateTimelineAssistantTurn(context, {
    message: sanitizedInput.message,
    conversation: sanitizedInput.conversation,
    timeline: sanitizedInput.timeline,
    language: resolvedLanguage,
    incidentCategory: sanitizedInput.incidentCategory,
    contextText,
    citations,
    ragUnavailable
  });
  let output = (modelResponse.output ?? {}) as Record<string, unknown>;
  if (!(typeof output.assistantMessage === 'string' && output.assistantMessage.trim())) {
    modelResponse = await generateTimelineAssistantTurn(context, {
      message: sanitizedInput.message,
      conversation: sanitizedInput.conversation,
      timeline: sanitizedInput.timeline,
      language: resolvedLanguage,
      incidentCategory: sanitizedInput.incidentCategory,
      contextText,
      citations,
      ragUnavailable
    });
    output = (modelResponse.output ?? {}) as Record<string, unknown>;
  }
  const timelineCandidate = (output.timeline ?? {}) as Record<string, unknown>;
  const timelineFallback = buildTimelineFallback(sanitizedInput, timelineCandidate);
  const resolvedTimeline = compactTimelineObject(
    normalizeTimelineObject(sanitizedInput.timeline, timelineCandidate, timelineFallback),
    sanitizedInput.message
  );
  const assistantMessage =
    typeof output.assistantMessage === 'string' && output.assistantMessage.trim()
      ? enforceAiOutputGuardrails(output.assistantMessage)
      : "I couldn't generate the next timeline step reliably. Please try again.";
  const legalAwareness = shouldAttachNswLegalAwareness({
    text: sanitizedInput.message,
    jurisdiction: sanitizedInput.jurisdiction,
    incidentCategory: sanitizedInput.incidentCategory,
    category: classifySourceCategory({ query: sanitizedInput.message } as RagSearchInput)
  })
    ? buildNswLegalAwareness({
        sourceStatus:
          results.length > 0 ? 'approved_sources_used' : 'insufficient_approved_sources',
        topic:
          sanitizedInput.incidentCategory === 'migrant_challenges' ? 'migrant_challenges' : 'racial_abuse'
      })
    : undefined;

  await auditRagAction(context, RAG_ACTIONS.answer, undefined, {
    mode: 'timeline_assistant',
    citationCount: results.length,
    ragUnavailable,
    encodingWarning: timelineAssistantInput.encodingWarning
  });

  const sourceDisplayMeta = buildAssistantSourceDisplayMeta({
    message: sanitizedInput.message,
    citations: results.map((result) => ({
      title: result.title,
      sectionRef: result.sectionRef,
      url: result.citationUrl
    }))
  });

  logger.info(
    {
      mode: 'timeline_assistant',
      assistantResponseUnicodeEscaped: escapeUnicodeForLog(assistantMessage),
      assistantResponseFirst120: escapeUnicodeForLog(assistantMessage.slice(0, 120)),
      reviewStatus: modelResponse.reviewStatus,
      encodingWarning: timelineAssistantInput.encodingWarning
    },
    'Timeline assistant response'
  );

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
    showSources: sourceDisplayMeta.showSources,
    sourceDisplayReason: sourceDisplayMeta.sourceDisplayReason,
    legalAwareness,
    rag: {
      used: results.length > 0,
      unavailable: ragUnavailable,
      resultCount: results.length
    },
    reviewStatus: modelResponse.reviewStatus,
    interactionId: modelResponse.interactionId,
    encodingWarning: timelineAssistantInput.encodingWarning
  };
};
