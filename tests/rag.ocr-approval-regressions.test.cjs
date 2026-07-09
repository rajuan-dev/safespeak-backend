const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const { env } = require('../src/config/env.ts');
const { AuditLogModel } = require('../src/modules/audit/audit.model');
const { ConsentRecordModel } = require('../src/modules/consent/consent.model');
const pineconeService = require('../src/modules/rag/pinecone-vector.service.ts');
const ragModel = require('../src/modules/rag/rag.model.ts');
const ragService = require('../src/modules/rag/rag.service.ts');

const originalEnv = {
  OCR_MIN_CONFIDENCE: env.OCR_MIN_CONFIDENCE,
  PINECONE_API_KEY: env.PINECONE_API_KEY,
  PINECONE_INDEX_NAME: env.PINECONE_INDEX_NAME,
  PINECONE_NAMESPACE: env.PINECONE_NAMESPACE,
  RAG_VECTOR_PROVIDER: env.RAG_VECTOR_PROVIDER,
};

const SOURCE_ID = '507f1f77bcf86cd799439011';
const CHUNK_ID = '607f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';

const makeQuery = (resolver) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean() {
    return Promise.resolve(resolver());
  },
  then(resolve, reject) {
    return Promise.resolve(resolver()).then(resolve, reject);
  },
});

const buildLongLegalText = () =>
  [
    'Section 1 Preliminary. This Act explains complaint pathways, review rights, agency reporting options, and evidentiary handling for online abuse matters in New South Wales.',
    'Section 2 Definitions. A person affected by online abuse may preserve screenshots, retain message logs, and seek official information about eSafety, police, and support pathways where appropriate.',
    'Section 3 Pathways. This approved OCR legal source should remain retrievable after review so the system can cite authority, jurisdiction, and section information without inventing citations.',
  ].join(' ');

const hashText = (value) => createHash('sha256').update(value).digest('hex');

const createHarness = () => {
  const now = new Date('2026-06-04T10:00:00.000Z');
  let revision = 0;
  const chunkText = buildLongLegalText();
  let persistedSource = {
    _id: SOURCE_ID,
    title: 'Online Safety Act OCR Source',
    sourceTitle: 'Online Safety Act OCR Source',
    description: 'OCR legal source',
    sourceCategory: 'official_legal_source',
    sourceType: 'legislation',
    sourceAuthority: 'Commonwealth of Australia',
    officialUrl: 'https://example.gov.au/online-safety-act',
    country: 'Australia',
    jurisdiction: 'AU',
    stateOrTerritory: 'NSW',
    pathwayCategory: 'reporting',
    legalDomain: 'online_safety',
    topic: 'online_safety',
    legislationName: 'Online Safety Act',
    language: 'en',
    publisher: 'Commonwealth of Australia',
    licenseStatus: 'open',
    sourceDate: new Date('2026-05-01T00:00:00.000Z'),
    lastUpdated: new Date('2026-05-01T00:00:00.000Z'),
    lastVerifiedAt: new Date('2026-06-03T00:00:00.000Z'),
    nextRefreshAt: new Date('2026-09-01T00:00:00.000Z'),
    nextReviewAt: new Date('2026-09-01T00:00:00.000Z'),
    refreshCadence: 'quarterly',
    sha256Hash: hashText(chunkText),
    legalReviewed: false,
    status: 'approved',
    ingestionStatus: 'pending_ocr_review',
    version: 1,
    active: true,
    extractionMethod: 'ocr',
    ocrProvider: 'tesseract',
    ocrAverageConfidence: 0.97,
    ocrPageCount: 3,
    ocrWarnings: [],
    ocrReviewRequired: true,
    ocrStatus: 'pending_review',
    sourceReliability: 'official',
    rawText: chunkText,
    embeddingModel: undefined,
    pineconeIndex: undefined,
    pineconeNamespace: undefined,
    metadata: {
      extractionMethod: 'ocr',
      ocrStatus: 'pending_review',
      ocrReviewRequired: true,
      chunkCount: 0,
      indexedChunkCount: 0,
      pineconeVectorCount: 0,
      mongoChunkCount: 0,
      indexSyncStatus: 'pending',
      ingestionPipeline: {
        extractor: 'tesseract',
      },
    },
    createdAt: now,
    updatedAt: now,
  };

  let chunks = [];
  const upsertedVectors = [];
  let deleteBySourceCalls = 0;

  const clone = (value) => structuredClone(value);

  const assignPersisted = (next) => {
    revision += 1;
    persistedSource = {
      ...clone(next),
      _id: SOURCE_ID,
      updatedAt: new Date(now.getTime() + revision * 1000),
    };
  };

  const createSourceDocument = () => {
    const snapshot = clone(persistedSource);
    snapshot.save = async () => {
      const { save: _save, toObject: _toObject, ...serializable } = snapshot;
      assignPersisted(serializable);
    };
    snapshot.toObject = () => clone(persistedSource);
    return snapshot;
  };

  const filterSources = (filter = {}) => {
    const matchesSourceId =
      !filter._id ||
      (filter._id.$in
        ? filter._id.$in.some((value) => String(value) === SOURCE_ID)
        : String(filter._id) === SOURCE_ID);
    const matchesLegalReviewed =
      typeof filter.legalReviewed === 'boolean'
        ? persistedSource.legalReviewed === filter.legalReviewed
        : true;
    const matchesCategory = filter.sourceCategory
      ? persistedSource.sourceCategory === filter.sourceCategory
      : true;
    const matchesTopic = filter.topic ? persistedSource.topic === filter.topic : true;
    const matchesJurisdiction = filter.jurisdiction
      ? filter.jurisdiction.$in
        ? filter.jurisdiction.$in.includes(persistedSource.jurisdiction)
        : persistedSource.jurisdiction === filter.jurisdiction
      : true;

    return matchesSourceId &&
      matchesLegalReviewed &&
      matchesCategory &&
      matchesTopic &&
      matchesJurisdiction &&
      persistedSource.deletedAt === undefined
      ? [clone(persistedSource)]
      : [];
  };

  return {
    get persistedSource() {
      return persistedSource;
    },
    get chunks() {
      return chunks;
    },
    get upsertedVectors() {
      return upsertedVectors;
    },
    get deleteBySourceCalls() {
      return deleteBySourceCalls;
    },
    replaceSource(next) {
      assignPersisted(next);
    },
    setChunks(nextChunks) {
      chunks = clone(nextChunks);
    },
    mocks(t) {
      t.mock.method(ConsentRecordModel, 'findOne', () => makeQuery(() => ({
        flags: { process_with_ai: true },
      })));
      t.mock.method(AuditLogModel, 'create', async () => ({}));
      t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
        const body = JSON.parse(options.body ?? '{}');
        const inputs = Array.isArray(body.input) ? body.input : [body.input];

        return {
          ok: true,
          json: async () => ({
            data: inputs.map((_, index) => ({
              embedding: Array.from({ length: 8 }, () => index + 0.1),
            })),
          }),
        };
      });
      t.mock.method(pineconeService.pineconeVectorStore, 'deleteBySource', async () => {
        deleteBySourceCalls += 1;
      });
      t.mock.method(pineconeService.pineconeVectorStore, 'upsertChunks', async ({ chunks: batch }) => {
        upsertedVectors.push(...clone(batch));
      });
      t.mock.method(pineconeService.pineconeVectorStore, 'search', async () =>
        upsertedVectors.map((vector, index) => ({
          chunkId: String(vector.metadata.chunkId),
          sourceId: String(vector.metadata.sourceId),
          score: 0.99 - index * 0.01,
          metadata: clone(vector.metadata),
        }))
      );

      t.mock.method(ragModel.RagKnowledgeSourceModel, 'findOne', async () => createSourceDocument());
      t.mock.method(ragModel.RagKnowledgeSourceModel, 'updateOne', async (_filter, update) => {
        const set = update.$set ?? {};
        assignPersisted({
          ...persistedSource,
          metadata: {
            ...persistedSource.metadata,
            ...clone(set.metadata ?? {}),
            chunkCount: set['metadata.chunkCount'] ?? persistedSource.metadata.chunkCount,
            indexedChunkCount:
              set['metadata.indexedChunkCount'] ?? persistedSource.metadata.indexedChunkCount,
            pineconeIndexed:
              set['metadata.pineconeIndexed'] ?? persistedSource.metadata.pineconeIndexed,
            pineconeVectorCount:
              set['metadata.pineconeVectorCount'] ?? persistedSource.metadata.pineconeVectorCount,
            mongoChunkCount:
              set['metadata.mongoChunkCount'] ?? persistedSource.metadata.mongoChunkCount,
            lastIndexedAt:
              set['metadata.lastIndexedAt'] ?? persistedSource.metadata.lastIndexedAt,
            indexSyncStatus:
              set['metadata.indexSyncStatus'] ?? persistedSource.metadata.indexSyncStatus,
            indexSyncError:
              set['metadata.indexSyncError'] ?? persistedSource.metadata.indexSyncError,
            pineconeIndexedAt:
              set['metadata.pineconeIndexedAt'] ?? persistedSource.metadata.pineconeIndexedAt,
            pineconeNamespace:
              set['metadata.pineconeNamespace'] ?? persistedSource.metadata.pineconeNamespace,
            pineconeIndexName:
              set['metadata.pineconeIndexName'] ?? persistedSource.metadata.pineconeIndexName,
          },
        });

        return { acknowledged: true };
      });
      t.mock.method(ragModel.RagKnowledgeSourceModel, 'find', (filter = {}) =>
        makeQuery(() => filterSources(filter))
      );

      t.mock.method(ragModel.RagChunkModel, 'bulkWrite', async (operations) => {
        for (const operation of operations) {
          const updateOne = operation.updateOne;
          if (!updateOne) {
            continue;
          }

          if ('chunkIndex' in updateOne.filter) {
            const nextChunk = clone(updateOne.update.$set);
            const existingIndex = chunks.findIndex(
              (chunk) =>
                String(chunk.sourceId) === String(nextChunk.sourceId) &&
                chunk.chunkIndex === nextChunk.chunkIndex
            );

            if (existingIndex >= 0) {
              chunks[existingIndex] = {
                ...chunks[existingIndex],
                ...nextChunk,
              };
            } else {
              chunks.push({
                _id: CHUNK_ID,
                ...nextChunk,
              });
            }
            continue;
          }

          if (updateOne.filter._id) {
            const chunkId = String(updateOne.filter._id);
            chunks = chunks.map((chunk) =>
              chunk._id.toString() === chunkId
                ? {
                    ...chunk,
                    ...clone(updateOne.update.$set),
                    metadata: {
                      ...chunk.metadata,
                      ...clone(updateOne.update.$set?.metadata ?? {}),
                      pineconeVectorId:
                        updateOne.update.$set?.['metadata.pineconeVectorId'] ??
                        chunk.metadata?.pineconeVectorId,
                      pineconeIndexedAt:
                        updateOne.update.$set?.['metadata.pineconeIndexedAt'] ??
                        chunk.metadata?.pineconeIndexedAt,
                      embeddingStatus:
                        updateOne.update.$set?.['metadata.embeddingStatus'] ??
                        chunk.metadata?.embeddingStatus,
                      embeddingError:
                        updateOne.update.$set?.['metadata.embeddingError'] ??
                        chunk.metadata?.embeddingError,
                    },
                  }
                : chunk
            );
          }
        }

        return { acknowledged: true };
      });
      t.mock.method(ragModel.RagChunkModel, 'deleteMany', async (filter) => {
        if (filter.sourceId && filter.chunkIndex?.$gte !== undefined) {
          chunks = chunks.filter((chunk) => chunk.chunkIndex < filter.chunkIndex.$gte);
        } else if (filter.sourceId) {
          chunks = [];
        }

        return { acknowledged: true };
      });
      t.mock.method(ragModel.RagChunkModel, 'updateMany', async (_filter, update) => {
        chunks = chunks.map((chunk) => ({
          ...chunk,
          legalReviewed:
            update.$set?.legalReviewed !== undefined
              ? update.$set.legalReviewed
              : chunk.legalReviewed,
          active:
            update.$set?.active !== undefined
              ? update.$set.active
              : chunk.active,
          pineconeVectorId:
            update.$set?.pineconeVectorId !== undefined
              ? update.$set.pineconeVectorId
              : chunk.pineconeVectorId,
          metadata: {
            ...chunk.metadata,
            legalReviewed:
              update.$set?.['metadata.legalReviewed'] !== undefined
                ? update.$set['metadata.legalReviewed']
                : chunk.metadata?.legalReviewed,
            active:
              update.$set?.['metadata.active'] !== undefined
                ? update.$set['metadata.active']
                : chunk.metadata?.active,
            pineconeVectorId:
              update.$set?.['metadata.pineconeVectorId'] !== undefined
                ? update.$set['metadata.pineconeVectorId']
                : chunk.metadata?.pineconeVectorId,
          },
        }));

        return { acknowledged: true };
      });
      t.mock.method(ragModel.RagChunkModel, 'find', (filter = {}) =>
        makeQuery(() => {
          if (filter._id?.$in) {
            const ids = new Set(filter._id.$in.map(String));
            return chunks.filter((chunk) => ids.has(chunk._id.toString())).map(clone);
          }

          return chunks
            .filter((chunk) =>
              filter.sourceId ? String(chunk.sourceId) === String(filter.sourceId) : true
            )
            .sort((left, right) => left.chunkIndex - right.chunkIndex)
            .map(clone);
        })
      );
    },
  };
};

test.beforeEach(() => {
  env.OCR_MIN_CONFIDENCE = 0.85;
  env.PINECONE_API_KEY = 'test-pinecone-key';
  env.PINECONE_INDEX_NAME = 'safespeak-legislation-test';
  env.PINECONE_NAMESPACE = 'test';
  env.RAG_VECTOR_PROVIDER = 'pinecone';
});

test.after(() => {
  env.OCR_MIN_CONFIDENCE = originalEnv.OCR_MIN_CONFIDENCE;
  env.PINECONE_API_KEY = originalEnv.PINECONE_API_KEY;
  env.PINECONE_INDEX_NAME = originalEnv.PINECONE_INDEX_NAME;
  env.PINECONE_NAMESPACE = originalEnv.PINECONE_NAMESPACE;
  env.RAG_VECTOR_PROVIDER = originalEnv.RAG_VECTOR_PROVIDER;
});

test('approve-ocr legal flow reindexes reviewed OCR chunks and keeps them retrievable', async (t) => {
  const harness = createHarness();
  harness.mocks(t);

  const approved = await ragService.approveOcrKnowledgeSource(
    { owner: { userId: USER_ID }, actorType: 'admin' },
    SOURCE_ID,
    { legalReviewed: true }
  );

  assert.equal(approved.source.ocrStatus, 'reviewed');
  assert.equal(approved.source.legalReviewed, true);
  assert.ok(harness.upsertedVectors.length > 0);
  assert.equal(harness.upsertedVectors[0].metadata.legalReviewed, true);
  assert.ok(harness.chunks.length > 0);
  assert.equal(harness.chunks[0].legalReviewed, true);

  const results = await ragService.searchRag(
    { owner: { userId: USER_ID } },
    {
      query: 'What official reporting pathway exists for online abuse in NSW?',
      sourceCategory: 'official_legal_source',
      jurisdiction: 'AU',
      stateOrTerritory: 'NSW',
      topic: 'online_safety',
      legalDomain: 'online_safety',
      pathwayCategory: 'reporting',
    }
  );

  assert.equal(results.length > 0, true);
  assert.equal(results[0].sourceId, SOURCE_ID);
  assert.equal(results[0].sourceAuthority, 'Commonwealth of Australia');
});

test('approve-ocr returns the fresh persisted source instead of stale pre-ingest state', async (t) => {
  const harness = createHarness();
  harness.mocks(t);

  const approved = await ragService.approveOcrKnowledgeSource(
    { owner: { userId: USER_ID }, actorType: 'admin' },
    SOURCE_ID,
    { legalReviewed: true }
  );

  assert.equal(approved.source.indexSyncStatus, 'synced');
  assert.equal(approved.source.mongoChunkCount > 0, true);
  assert.equal(approved.source.pineconeVectorCount > 0, true);
  assert.ok(approved.source.lastIndexedAt);
  assert.equal(harness.persistedSource.metadata.indexSyncStatus, 'synced');
  assert.equal(
    approved.source.lastIndexedAt,
    harness.persistedSource.metadata.lastIndexedAt
  );
});

test('Pinecone upsert populates chunk.pineconeVectorId and source provenance fields', async (t) => {
  const harness = createHarness();
  harness.mocks(t);

  const approved = await ragService.approveOcrKnowledgeSource(
    { owner: { userId: USER_ID }, actorType: 'admin' },
    SOURCE_ID,
    { legalReviewed: true }
  );

  assert.ok(harness.chunks[0].pineconeVectorId);
  assert.equal(
    harness.chunks[0].pineconeVectorId,
    harness.chunks[0].metadata.pineconeVectorId
  );
  assert.equal(approved.source.embeddingModel, env.OPENAI_EMBEDDING_MODEL);
  assert.equal(approved.source.pineconeIndex, env.PINECONE_INDEX_NAME);
  assert.equal(approved.source.pineconeNamespace, env.PINECONE_NAMESPACE);

  const status = await ragService.getKnowledgeSourceStatus(
    { owner: { userId: USER_ID }, actorType: 'admin' },
    SOURCE_ID
  );

  assert.equal(status.embeddingModel, env.OPENAI_EMBEDDING_MODEL);
  assert.equal(status.pineconeIndex, env.PINECONE_INDEX_NAME);
  assert.equal(status.pineconeNamespace, env.PINECONE_NAMESPACE);
});

test('approveKnowledgeSource syncs legalReviewed to embedded chunks and Pinecone metadata', async (t) => {
  const harness = createHarness();
  harness.replaceSource({
    ...harness.persistedSource,
    extractionMethod: 'text',
    ocrReviewRequired: false,
    ocrStatus: 'not_required',
    ingestionStatus: 'embedded',
    status: 'draft',
    legalReviewed: false,
    officialUrl: 'https://www.legislation.gov.au/C2004A00416/latest/text',
    url: 'https://www.legislation.gov.au/C2004A00416/latest/text',
    metadata: {
      ...harness.persistedSource.metadata,
      ocrReviewRequired: false,
      ocrStatus: 'not_required',
      indexSyncStatus: 'synced',
      pineconeIndexed: true,
      pineconeVectorCount: 1,
      indexedChunkCount: 1,
      chunkCount: 1,
      mongoChunkCount: 1,
    },
  });
  harness.setChunks([
    {
      _id: CHUNK_ID,
      sourceId: SOURCE_ID,
      chunkIndex: 0,
      chunkText: buildLongLegalText(),
      embedding: Array.from({ length: 8 }, () => 0.5),
      sourceCategory: 'official_legal_source',
      sourceAuthority: 'Commonwealth of Australia',
      jurisdiction: 'AU',
      stateOrTerritory: 'NSW',
      pathwayCategory: 'reporting',
      legalDomain: 'online_safety',
      topic: 'online_safety',
      sourceType: 'legislation',
      legalReviewed: false,
      active: true,
      citationLabel: 'Online Safety Act OCR Source [chunk 1]',
      citationUrl: 'https://www.legislation.gov.au/C2004A00416/latest/text',
      tokenCount: 50,
      metadata: {
        sourceTitle: 'Online Safety Act OCR Source',
        sourceAuthority: 'Commonwealth of Australia',
        sourceType: 'legislation',
        sourceCategory: 'official_legal_source',
        legalReviewed: false,
      },
    },
  ]);
  harness.mocks(t);

  const approved = await ragService.approveKnowledgeSource(
    { owner: { userId: USER_ID }, actorType: 'admin' },
    SOURCE_ID
  );

  assert.equal(approved.legalReviewed, true);
  assert.equal(harness.chunks[0].legalReviewed, true);
  assert.equal(harness.chunks[0].metadata.legalReviewed, true);
  assert.ok(harness.upsertedVectors.length > 0);
  assert.equal(harness.upsertedVectors[0].metadata.legalReviewed, true);
});

test('official legal search does not require sourceReliability=official when the source is already approved', async (t) => {
  const harness = createHarness();
  harness.replaceSource({
    ...harness.persistedSource,
    sourceReliability: 'unknown',
    legalReviewed: true,
    ingestionStatus: 'embedded',
    ocrReviewRequired: false,
    ocrStatus: 'not_required',
    metadata: {
      ...harness.persistedSource.metadata,
      indexSyncStatus: 'synced',
      pineconeIndexed: true,
      pineconeIndexedAt: '2026-06-04T00:00:00.000Z',
      pineconeVectorCount: 1,
      indexedChunkCount: 1,
      chunkCount: 1,
      mongoChunkCount: 1,
    },
  });
  harness.setChunks([
    {
      _id: CHUNK_ID,
      sourceId: SOURCE_ID,
      chunkIndex: 0,
      chunkText: buildLongLegalText(),
      embedding: Array.from({ length: 8 }, () => 0.5),
      sourceCategory: 'official_legal_source',
      sourceAuthority: 'Commonwealth of Australia',
      jurisdiction: 'AU',
      stateOrTerritory: 'NSW',
      pathwayCategory: 'reporting',
      legalDomain: 'online_safety',
      topic: 'online_safety',
      sourceType: 'legislation',
      legalReviewed: true,
      active: true,
      citationLabel: 'Online Safety Act OCR Source [chunk 1]',
      citationUrl: 'https://www.legislation.gov.au/C2004A00416/latest/text',
      tokenCount: 50,
      metadata: {
        sourceTitle: 'Online Safety Act OCR Source',
        sourceAuthority: 'Commonwealth of Australia',
        sourceType: 'legislation',
        sourceCategory: 'official_legal_source',
        legalReviewed: true,
      },
    },
  ]);
  harness.mocks(t);
  harness.upsertedVectors.push({
    id: `rag_source_${SOURCE_ID}_chunk_${CHUNK_ID}`,
    values: Array.from({ length: 8 }, () => 0.5),
    metadata: {
      chunkId: CHUNK_ID,
      sourceId: SOURCE_ID,
      sourceCategory: 'official_legal_source',
      jurisdiction: 'AU',
      stateOrTerritory: 'NSW',
      topic: 'online_safety',
      legalDomain: 'online_safety',
      pathwayCategory: 'reporting',
      sourceType: 'legislation',
      sourceAuthority: 'Commonwealth of Australia',
      sourceTitle: 'Online Safety Act OCR Source',
      title: 'Online Safety Act OCR Source',
      legalReviewed: true,
      active: true,
      status: 'approved',
    },
  });

  const results = await ragService.searchRag(
    { owner: { userId: USER_ID } },
    {
      query: 'What official reporting pathway exists for online abuse in NSW?',
      sourceCategory: 'official_legal_source',
      jurisdiction: 'AU',
      stateOrTerritory: 'NSW',
      topic: 'online_safety',
      legalDomain: 'online_safety',
      pathwayCategory: 'reporting',
    }
  );

  assert.equal(results.length > 0, true);
  assert.equal(results[0].sourceId, SOURCE_ID);
});
