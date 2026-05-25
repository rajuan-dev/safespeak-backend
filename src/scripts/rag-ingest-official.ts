import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { HydratedDocument } from 'mongoose';

import { logger } from '@common/utils/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { createEmbedding } from '@modules/ai/ai.service';
import { RAG_OFFICIAL_SOURCE_HOSTS } from '@modules/rag/rag.constants';
import {
  RagChunkModel,
  RagKnowledgeSourceModel,
  type RagKnowledgeSourceDocument
} from '@modules/rag/rag.model';

const FETCH_TIMEOUT_MS = 15000;
const MAX_FETCH_BYTES = 750000;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const DEFAULT_REFRESH_DAYS = 90;

type SourceConfig = {
  title: string;
  url: string;
  publisher: string;
  sourceCategory: 'official_legal_source' | 'official_support_source';
  jurisdiction:
    | 'Cth'
    | 'NSW'
    | 'VIC'
    | 'QLD'
    | 'SA'
    | 'WA'
    | 'TAS'
    | 'NT'
    | 'ACT'
    | 'AU'
    | 'Global';
  topic:
    | 'discrimination'
    | 'racial_hatred'
    | 'online_safety'
    | 'scam'
    | 'privacy'
    | 'workplace'
    | 'dv'
    | 'evidence'
    | 'support'
    | 'consent'
    | 'crisis'
    | 'education'
    | 'other';
  sourceType:
    | 'Act'
    | 'Regulation'
    | 'Guideline'
    | 'Form'
    | 'Decision'
    | 'Report'
    | 'Policy'
    | 'SupportResource'
    | 'FAQ'
    | 'WebPage';
  licenseStatus: string;
  legalReviewed?: boolean;
  lastUpdated?: string;
  lastVerifiedAt?: string;
  nextReviewAt?: string;
  nextRefreshAt?: string;
  reviewNotes?: string;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);

  return next;
};

const chunkText = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    chunks.push(normalized.slice(cursor, cursor + CHUNK_SIZE));
    cursor += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
};

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

const embedSourceText = async (
  doc: HydratedDocument<RagKnowledgeSourceDocument>,
  text: string,
  options: {
    contentType?: string;
    existingHash?: string;
  } = {}
): Promise<number> => {
  const hash = sha256(text);
  const chunks = chunkText(text);
  const previousHash = options.existingHash;

  doc.rawText = text;
  doc.sha256Hash = hash;
  doc.version = previousHash ? (previousHash === hash ? doc.version : (doc.version ?? 1) + 1) : 1;
  doc.ingestedAt = new Date();
  doc.ingestionStatus = 'fetched';
  doc.ingestionError = undefined;
  doc.metadata = {
    ...doc.metadata,
    ingestionMode: 'fetched_and_embedded',
    fetchImplemented: true,
    contentType: options.contentType
  };
  await doc.save();

  await RagChunkModel.deleteMany({ sourceId: doc._id });
  doc.ingestionStatus = 'chunked';
  await doc.save();

  const embeddedChunks = await Promise.all(
    chunks.map(async (chunk, index) => ({
      sourceId: doc._id,
      sourceCategory: doc.sourceCategory,
      jurisdiction: doc.jurisdiction,
      topic: doc.topic,
      chunkIndex: index,
      chunkText: chunk,
      embedding: await createEmbedding(chunk),
      tokenCount: Math.ceil(chunk.length / 4),
      citationLabel: `${doc.title} [chunk ${index + 1}]`,
      citationUrl: doc.url,
      metadata: {
        sourceTitle: doc.title,
        sourceType: doc.sourceType,
        sourceCategory: doc.sourceCategory,
        language: doc.language,
        jurisdiction: doc.jurisdiction
      }
    }))
  );

  if (embeddedChunks.length > 0) {
    await RagChunkModel.insertMany(embeddedChunks);
  }

  doc.ingestionStatus = 'embedded';
  doc.metadata = {
    ...doc.metadata,
    ingestionMode: 'fetched_and_embedded',
    fetchImplemented: true,
    chunkCount: embeddedChunks.length,
    contentType: options.contentType
  };
  await doc.save();

  return embeddedChunks.length;
};

const isAllowedUrl = (raw: string): boolean => {
  const host = new URL(raw).hostname.toLowerCase();

  return RAG_OFFICIAL_SOURCE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

const isBinarySource = (url: URL, contentType: string): boolean =>
  /\.(pdf|doc|docx|rtf)$/i.test(url.pathname) ||
  /pdf|msword|officedocument|octet-stream/i.test(contentType);

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

const fetchOfficialText = async (
  rawUrl: string
): Promise<
  | { kind: 'metadata_only'; message: string; contentType?: string }
  | { kind: 'text'; text: string; contentType?: string }
> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'SafeSpeak-RAG-Ingestion/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const url = new URL(rawUrl);

    if (isBinarySource(url, contentType)) {
      return {
        kind: 'metadata_only',
        contentType,
        message:
          'Binary or document-style official source requires manual text extraction before chunking.'
      };
    }

    const text = await response.text();

    if (text.length > MAX_FETCH_BYTES) {
      return {
        kind: 'metadata_only',
        contentType,
        message: `Fetched content exceeded max content length (${MAX_FETCH_BYTES} bytes).`
      };
    }

    const extractedText = htmlToText(text);

    if (extractedText.length < 200) {
      return {
        kind: 'metadata_only',
        contentType,
        message: 'Readable HTML text could not be extracted safely from the official source.'
      };
    }

    return { kind: 'text', text: extractedText, contentType };
  } finally {
    clearTimeout(timeout);
  }
};

const run = async (): Promise<void> => {
  const configuredPath =
    process.env.RAG_OFFICIAL_SOURCES_FILE ??
    process.argv[2] ??
    'knowledge/official-sources/sources.sample.json';
  const configPath = path.resolve(process.cwd(), configuredPath);
  const config = JSON.parse(await readFile(configPath, 'utf8')) as SourceConfig[];

  await connectDatabase();

  try {
    for (const source of config) {
      if (!isAllowedUrl(source.url)) {
        logger.warn({ url: source.url }, 'Skipping URL outside allowed official domains');
        continue;
      }

      const existing = await RagKnowledgeSourceModel.findOne({
        sourceCategory: source.sourceCategory,
        $or: [{ url: source.url }, { title: source.title }]
      });
      const lastUpdated = source.lastUpdated ? new Date(source.lastUpdated) : new Date();
      const nextRefreshAt = source.nextRefreshAt
        ? new Date(source.nextRefreshAt)
        : addDays(lastUpdated, DEFAULT_REFRESH_DAYS);

      const doc =
        existing ??
        new RagKnowledgeSourceModel({
          ...source,
          language: 'en',
          legalReviewed: source.legalReviewed ?? false,
          lastUpdated,
          lastVerifiedAt: source.lastVerifiedAt ? new Date(source.lastVerifiedAt) : new Date(),
          nextReviewAt: source.nextReviewAt ? new Date(source.nextReviewAt) : undefined,
          nextRefreshAt,
          reviewNotes: source.reviewNotes,
          status: 'pending_review',
          version: 1,
          metadata: {}
        });

      doc.title = source.title;
      doc.publisher = source.publisher;
      doc.sourceCategory = source.sourceCategory;
      doc.jurisdiction = source.jurisdiction;
      doc.topic = source.topic;
      doc.sourceType = source.sourceType;
      doc.url = source.url;
      doc.licenseStatus = source.licenseStatus;
      doc.legalReviewed = false;
      doc.status = 'pending_review';
      doc.lastUpdated = lastUpdated;
      doc.lastVerifiedAt = source.lastVerifiedAt ? new Date(source.lastVerifiedAt) : new Date();
      doc.nextReviewAt = source.nextReviewAt ? new Date(source.nextReviewAt) : doc.nextReviewAt;
      doc.nextRefreshAt = nextRefreshAt;
      doc.reviewNotes = source.reviewNotes ?? doc.reviewNotes;

      try {
        const fetched = await fetchOfficialText(source.url);
        doc.fetchedAt = new Date();
        doc.ingestionError = undefined;

        if (fetched.kind === 'metadata_only') {
          await RagChunkModel.deleteMany({ sourceId: doc._id });
          doc.ingestionStatus = 'metadata_only';
          doc.metadata = {
            ...doc.metadata,
            ingestionMode: 'metadata_only',
            fetchImplemented: true,
            contentType: fetched.contentType
          };
          await doc.save();
          logger.warn(
            { title: source.title, reason: fetched.message },
            'Official source stored as metadata only'
          );
          continue;
        }

        const hash = sha256(fetched.text);
        const chunks = chunkText(fetched.text);
        const existingChunkCount = await RagChunkModel.countDocuments({ sourceId: doc._id });

        if (existing?.sha256Hash === hash && existingChunkCount > 0) {
          doc.ingestionStatus = 'embedded';
          doc.ingestionError = undefined;
          doc.metadata = {
            ...doc.metadata,
            ingestionMode: 'fetched_and_embedded',
            fetchImplemented: true,
            chunkCount: chunks.length,
            contentType: fetched.contentType
          };
          await doc.save();
          logger.info({ title: source.title }, 'Skipping unchanged official source');
          continue;
        }

        const embeddedChunkCount = await embedSourceText(doc, fetched.text, {
          contentType: fetched.contentType,
          existingHash: existing?.sha256Hash
        });
        logger.info(
          { title: source.title, chunks: embeddedChunkCount },
          'Official source ingested and embedded'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const cachedText =
          typeof doc.rawText === 'string' && doc.rawText.trim().length >= 200
            ? doc.rawText
            : undefined;
        const existingChunkCount = await RagChunkModel.countDocuments({ sourceId: doc._id });

        if (cachedText && existingChunkCount === 0) {
          const cachedContentType =
            typeof doc.metadata.contentType === 'string' ? doc.metadata.contentType : undefined;
          const embeddedChunkCount = await embedSourceText(doc, cachedText, {
            contentType: cachedContentType,
            existingHash: doc.sha256Hash
          });

          doc.metadata = {
            ...doc.metadata,
            refreshFallback: 'cached_raw_text',
            lastRefreshError: errorMessage,
            lastRefreshFailedAt: new Date().toISOString()
          };
          await doc.save();
          logger.warn(
            { title: source.title, chunks: embeddedChunkCount, errorMessage },
            'Official source refresh failed; restored cached embedded source'
          );
          continue;
        }

        if (existingChunkCount > 0 || cachedText) {
          doc.ingestionStatus = 'embedded';
          doc.ingestionError = undefined;
          doc.metadata = {
            ...doc.metadata,
            refreshFallback: 'existing_embedded_content',
            lastRefreshError: errorMessage,
            lastRefreshFailedAt: new Date().toISOString()
          };
          await doc.save();
          logger.warn(
            { title: source.title, chunks: existingChunkCount, errorMessage },
            'Official source refresh failed; preserved existing embedded source'
          );
          continue;
        }

        await RagChunkModel.deleteMany({ sourceId: doc._id });
        doc.ingestionStatus = 'failed';
        doc.ingestionError = errorMessage;
        doc.metadata = {
          ...doc.metadata,
          ingestionMode: 'failed_fetch',
          fetchImplemented: true
        };
        await doc.save();
        logger.error(
          {
            title: source.title,
            error,
            errorMessage: error instanceof Error ? error.message : String(error)
          },
          'Official source ingestion failed'
        );
      }
    }
  } finally {
    await disconnectDatabase();
  }
};

void run().catch((error: unknown) => {
  logger.error({ error }, 'rag:ingest:official failed');
  process.exit(1);
});
