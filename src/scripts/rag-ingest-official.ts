import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '@common/utils/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { RAG_OFFICIAL_SOURCE_HOSTS } from '@modules/rag/rag.constants';
import {
  RagKnowledgeSourceModel
} from '@modules/rag/rag.model';
import { refreshKnowledgeSource } from '@modules/rag/rag.service';

const DEFAULT_REFRESH_DAYS = 90;
const SCRIPT_CONTEXT = {
  owner: { sessionId: 'script:rag-ingest-official' },
  actorType: 'admin' as const
};

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
  sourceAuthority?: string;
  authority?: string;
  legalReviewed?: boolean;
  lastUpdated?: string;
  sourceDate?: string;
  lastVerifiedAt?: string;
  nextReviewAt?: string;
  nextRefreshAt?: string;
  refreshCadence?: 'quarterly' | 'event_driven' | 'monthly' | 'manual';
  reviewNotes?: string;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);

  return next;
};

const isAllowedUrl = (raw: string): boolean => {
  const host = new URL(raw).hostname.toLowerCase();

  return RAG_OFFICIAL_SOURCE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
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
          sourceAuthority: source.sourceAuthority ?? source.authority ?? source.publisher,
          authority: source.authority ?? source.sourceAuthority ?? source.publisher,
          legalReviewed: source.legalReviewed ?? false,
          lastUpdated,
          sourceDate: source.sourceDate ? new Date(source.sourceDate) : lastUpdated,
          lastVerifiedAt: source.lastVerifiedAt ? new Date(source.lastVerifiedAt) : new Date(),
          nextReviewAt: source.nextReviewAt ? new Date(source.nextReviewAt) : undefined,
          nextRefreshAt,
          refreshCadence: source.refreshCadence ?? 'quarterly',
          reviewNotes: source.reviewNotes,
          status: 'pending_review',
          version: 1,
          metadata: {}
        });

      doc.title = source.title;
      doc.publisher = source.publisher;
      doc.sourceAuthority = source.sourceAuthority ?? source.authority ?? source.publisher;
      doc.authority = source.authority ?? source.sourceAuthority ?? source.publisher;
      doc.sourceCategory = source.sourceCategory;
      doc.jurisdiction = source.jurisdiction;
      doc.topic = source.topic;
      doc.sourceType = source.sourceType;
      doc.url = source.url;
      doc.licenseStatus = source.licenseStatus;
      doc.legalReviewed = false;
      doc.status = 'pending_review';
      doc.lastUpdated = lastUpdated;
      doc.sourceDate = source.sourceDate ? new Date(source.sourceDate) : lastUpdated;
      doc.lastVerifiedAt = source.lastVerifiedAt ? new Date(source.lastVerifiedAt) : new Date();
      doc.nextReviewAt = source.nextReviewAt ? new Date(source.nextReviewAt) : doc.nextReviewAt;
      doc.nextRefreshAt = nextRefreshAt;
      doc.refreshCadence = source.refreshCadence ?? 'quarterly';
      doc.reviewNotes = source.reviewNotes ?? doc.reviewNotes;

      try {
        const refreshResult = await refreshKnowledgeSource(SCRIPT_CONTEXT, doc._id.toString(), {
          metadata: {}
        });
        logger.info(
          { title: source.title, result: refreshResult },
          'Official source refreshed through shared RAG pipeline'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          {
            title: source.title,
            error,
            errorMessage
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
