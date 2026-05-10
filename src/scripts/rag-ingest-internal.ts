import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@common/utils/logger';
import { connectDatabase, disconnectDatabase } from '@config/database';
import { env } from '@config/env';
import { createEmbedding } from '@modules/ai/ai.service';
import { RagChunkModel, RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import type { RagTopic } from '@modules/rag/rag.types';
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
const chunkText = (text: string, size = 1200, overlap = 150): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    chunks.push(normalized.slice(cursor, cursor + size));
    cursor += size - overlap;
  }
  return chunks;
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
      source.localFilePath = filePath;
      source.ingestedAt = new Date();
      source.version = existing ? (source.version ?? 1) + 1 : 1;
      await source.save();
      await RagChunkModel.deleteMany({ sourceId: source._id });
      const chunks = chunkText(rawText);
      const docs = await Promise.all(chunks.map(async (chunk, idx) => ({ sourceId: source._id, sourceCategory: source.sourceCategory, jurisdiction: source.jurisdiction, topic: source.topic, chunkIndex: idx, chunkText: chunk, embedding: await createEmbedding(chunk), tokenCount: Math.ceil(chunk.length / 4), citationLabel: `${source.title} [chunk ${idx + 1}]`, citationUrl: source.url, metadata: { sourceType: source.sourceType } })));
      if (docs.length > 0) await RagChunkModel.insertMany(docs);
      logger.info({ file: file.name, chunks: docs.length, status }, 'Internal knowledge ingested');
    }
  } finally {
    await disconnectDatabase();
  }
};
void run().catch((error: unknown) => {
  logger.error({ error }, 'rag:ingest:internal failed');
  process.exit(1);
});
