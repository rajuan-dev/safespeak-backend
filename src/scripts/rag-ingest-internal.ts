import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@common/utils/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { env } from '@config/env';
import { RagChunkModel, RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import { ingestKnowledgeSource } from '@modules/rag/rag.service';
import type { RagTopic } from '@modules/rag/rag.types';
const SCRIPT_CONTEXT = {
  owner: { sessionId: 'script:rag-ingest-internal' },
  actorType: 'admin' as const
};
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.json']);
const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');
const toTitle = (fileName: string): string => fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const classifyInternalFile = (
  fileName: string
): { topic: RagTopic; sourceType: 'ProductRequirement' | 'Policy' } => {
  const normalized = fileName.toLowerCase();

  if (normalized.includes('policy') || normalized.includes('ai-rag')) {
    return { topic: 'safespeak_policy', sourceType: 'Policy' };
  }

  if (normalized.includes('consent')) {
    return { topic: 'consent', sourceType: 'Policy' };
  }

  if (normalized.includes('support')) {
    return { topic: 'support', sourceType: 'Policy' };
  }

  return { topic: 'safespeak_policy', sourceType: 'ProductRequirement' };
};
const run = async (): Promise<void> => {
  const dir = path.resolve(process.cwd(), env.INTERNAL_KNOWLEDGE_DIR);
  await connectDatabase();
  try {
    const allFiles = await readdir(dir, { withFileTypes: true });
    const files = allFiles.filter(
      (entry) =>
        entry.isFile()
        && entry.name.toLowerCase() !== 'readme.md'
        && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    );
    if (files.length === 0) {
      logger.info({ dir }, 'No internal files found. Add .txt, .md, or .json files to ingest.');
      return;
    }
    for (const file of files) {
      const filePath = path.join(dir, file.name);
      const rawText = await readFile(filePath, 'utf8');
      const hash = sha256(rawText);
      const existing = await RagKnowledgeSourceModel.findOne({ localFilePath: filePath, sourceCategory: 'internal_product_rule' });
      if (existing?.sha256Hash === hash) {
        logger.info({ file: file.name }, 'Skipping unchanged internal knowledge file');
        continue;
      }
      const classification = classifyInternalFile(file.name);
      const status = env.ENABLE_INTERNAL_KNOWLEDGE_AUTO_APPROVE ? 'approved' : 'pending_review';
      const source =
        existing
        ?? new RagKnowledgeSourceModel({
          title: toTitle(file.name),
          sourceCategory: 'internal_product_rule',
          sourceType: classification.sourceType,
          jurisdiction: 'Internal',
          topic: classification.topic,
          language: 'en',
          localFilePath: filePath,
          publisher: 'SafeSpeak',
          licenseStatus: 'Internal',
          legalReviewed: false,
          status,
          version: 1,
          metadata: {}
        });
      source.sourceType = classification.sourceType;
      source.topic = classification.topic;
      source.rawText = rawText;
      source.sha256Hash = hash;
      source.status = status;
      source.sourceTitle = source.title;
      source.sourceAuthority = 'SafeSpeak';
      source.country = 'Australia';
      source.sourceReliability = 'internal';
      source.active = true;
      source.localFilePath = filePath;
      source.ingestedAt = new Date();
      source.version = existing ? (source.version ?? 1) + 1 : 1;
      await source.save();
      await RagChunkModel.deleteMany({ sourceId: source._id });
      const result = await ingestKnowledgeSource(SCRIPT_CONTEXT, source._id.toString(), {
        content: rawText,
        expectedSha256: hash,
        metadata: {
          ingestionMode: 'internal_script'
        }
      });
      logger.info({ file: file.name, result, status }, 'Internal knowledge ingested through shared RAG pipeline');
    }
  } finally {
    await disconnectDatabase();
  }
};
void run().catch((error: unknown) => {
  logger.error({ error }, 'rag:ingest:internal failed');
  process.exit(1);
});
