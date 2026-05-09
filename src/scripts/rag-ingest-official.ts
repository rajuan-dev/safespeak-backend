import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { logger } from '@common/utils/logger';
import { env } from '@config/env';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';
const ALLOWED_DOMAINS = ['legislation.gov.au','austlii.edu.au','humanrights.gov.au','ahrc.gov.au','esafety.gov.au','oaic.gov.au','fairwork.gov.au','accc.gov.au','cyber.gov.au','scamwatch.gov.au','nsw.gov.au','vic.gov.au','qld.gov.au','sa.gov.au','wa.gov.au','tas.gov.au','nt.gov.au','act.gov.au'];
type SourceConfig = { title: string; url: string; publisher: string; sourceCategory: 'official_legal_source' | 'official_support_source'; jurisdiction: 'Cth' | 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT' | 'AU' | 'Global'; topic: 'discrimination' | 'racial_hatred' | 'online_safety' | 'scam' | 'privacy' | 'workplace' | 'dv' | 'evidence' | 'support' | 'consent' | 'crisis' | 'education' | 'other'; sourceType: 'Act' | 'Regulation' | 'Guideline' | 'Form' | 'Decision' | 'Report' | 'Policy' | 'SupportResource' | 'FAQ' | 'WebPage'; licenseStatus: string; legalReviewed?: boolean; lastUpdated?: string;};
const isAllowedUrl = (raw: string): boolean => { const host = new URL(raw).hostname.toLowerCase(); return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`)); };
const run = async (): Promise<void> => {
  const configPath = path.resolve(process.cwd(), 'knowledge/official-sources/sources.sample.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as SourceConfig[];
  await mongoose.connect(env.MONGODB_URI, { autoIndex: env.NODE_ENV !== 'production' });
  try {
    for (const source of config) {
      if (!isAllowedUrl(source.url)) { logger.warn({ url: source.url }, 'Skipping URL outside allowed official domains'); continue; }
      const existing = await RagKnowledgeSourceModel.findOne({ url: source.url, sourceCategory: source.sourceCategory });
      if (existing) { logger.info({ title: source.title }, 'Official source already exists'); continue; }
      await RagKnowledgeSourceModel.create({ ...source, language: 'en', legalReviewed: source.legalReviewed ?? false, lastUpdated: source.lastUpdated ? new Date(source.lastUpdated) : undefined, status: 'pending_review', version: 1, metadata: { ingestionMode: 'skeleton_config_only', fetchImplemented: false } });
      logger.info({ title: source.title }, 'Official source metadata created (pending_review)');
    }
    logger.info('URL fetch/content ingestion is intentionally not performed by this skeleton.');
  } finally {
    await mongoose.disconnect();
  }
};
void run().catch((error: unknown) => { logger.error({ error }, 'rag:ingest:official failed'); process.exit(1); });
