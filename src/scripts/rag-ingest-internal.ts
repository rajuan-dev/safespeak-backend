import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { logger } from '@common/utils/logger';
import { env } from '@config/env';
import { createEmbedding } from '@modules/ai/ai.service';
import { RagChunkModel, RagKnowledgeSourceModel } from '@modules/rag/rag.model';
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.json']);
const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');
const toTitle = (fileName: string): string => fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
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
  await mongoose.connect(env.MONGODB_URI, { autoIndex: env.NODE_ENV !== 'production' });
  try {
    const allFiles = await readdir(dir, { withFileTypes: true });
    const files = allFiles.filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
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
      const status = env.ENABLE_INTERNAL_KNOWLEDGE_AUTO_APPROVE ? 'approved' : 'pending_review';
      const source = existing ?? new RagKnowledgeSourceModel({ title: toTitle(file.name), sourceCategory: 'internal_product_rule', sourceType: 'ProductRequirement', jurisdiction: 'Internal', topic: 'safespeak_policy', language: 'en', localFilePath: filePath, publisher: 'SafeSpeak', licenseStatus: 'Internal', legalReviewed: false, status, metadata: {} });
      source.rawText = rawText;
      source.sha256Hash = hash;
      source.status = status;
      source.localFilePath = filePath;
      source.ingestedAt = new Date();
      source.version = (source.version ?? 1) + 1;
      await source.save();
      await RagChunkModel.deleteMany({ sourceId: source._id });
      const chunks = chunkText(rawText);
      const docs = await Promise.all(chunks.map(async (chunk, idx) => ({ sourceId: source._id, sourceCategory: source.sourceCategory, jurisdiction: source.jurisdiction, topic: source.topic, chunkIndex: idx, chunkText: chunk, embedding: await createEmbedding(chunk), tokenCount: Math.ceil(chunk.length / 4), citationLabel: `${source.title} [chunk ${idx + 1}]`, citationUrl: source.url, metadata: { sourceType: source.sourceType } })));
      if (docs.length > 0) await RagChunkModel.insertMany(docs);
      logger.info({ file: file.name, chunks: docs.length, status }, 'Internal knowledge ingested');
    }
  } finally {
    await mongoose.disconnect();
  }
};
void run().catch((error: unknown) => {
  logger.error({ error }, 'rag:ingest:internal failed');
  process.exit(1);
});
