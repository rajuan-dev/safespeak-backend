const assert = require('node:assert/strict');
const test = require('node:test');

const { envSchema } = require('../src/config/env.ts');
const {
  normalizeOcrExecutionOptions,
  paginateOcrPages,
  buildOcrStatusSummary,
} = require('../src/modules/rag/rag.service.ts');
const {
  buildOcrBatchRanges,
  resolveOcrPageLimit,
} = require('../src/modules/rag/ocr/tesseract-ocr.provider.ts');

test('OCR_MAX_PAGES=0 allows all document pages by config', () => {
  assert.equal(resolveOcrPageLimit(240, 0), 240);
});

test('OCR_MAX_PAGES positive value limits the processed page count', () => {
  assert.equal(resolveOcrPageLimit(240, 10), 10);
});

test('OCR batch ranges are built using OCR_BATCH_SIZE', () => {
  assert.deepEqual(buildOcrBatchRanges(12, 5, 0), [
    { startPage: 1, endPage: 5 },
    { startPage: 6, endPage: 10 },
    { startPage: 11, endPage: 12 },
  ]);
});

test('OCR execution options keep safe defaults and preserve unlimited mode', () => {
  const normalized = normalizeOcrExecutionOptions({
    maxPages: 0,
    batchSize: 7,
    pageTimeoutMs: 45000,
    jobTimeoutMs: 0,
  });

  assert.equal(normalized.maxPages, 0);
  assert.equal(normalized.batchSize, 7);
  assert.equal(normalized.pageTimeoutMs, 45000);
  assert.equal(normalized.jobTimeoutMs, 0);
});

test('OCR preview pagination returns compact page slices', () => {
  const paginated = paginateOcrPages(
    [
      { pageNumber: 1 },
      { pageNumber: 2 },
      { pageNumber: 3 },
      { pageNumber: 4 },
      { pageNumber: 5 },
      { pageNumber: 6 },
    ],
    2,
    2
  );

  assert.equal(paginated.page, 2);
  assert.equal(paginated.pageSize, 2);
  assert.equal(paginated.totalPages, 6);
  assert.deepEqual(paginated.pages, [{ pageNumber: 3 }, { pageNumber: 4 }]);
});

test('OCR status summary exposes progress and index sync fields for admin status views', () => {
  const summary = buildOcrStatusSummary({
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    title: 'Sample OCR Source',
    sourceTitle: 'Sample OCR Source',
    ingestionStatus: 'pending_ocr_review',
    active: true,
    legalReviewed: false,
    extractionMethod: 'ocr',
    ocrStatus: 'pending_review',
    ocrAverageConfidence: 0.93,
    ocrPageCount: 42,
    ocrProvider: 'tesseract',
    ocrWarnings: ['page 17 low confidence'],
    metadata: {
      ocrProgress: {
        totalPages: 42,
        processedPages: 42,
        completedPages: 39,
        failedPages: 1,
        lowConfidencePages: 2,
        currentBatchStart: 41,
        currentBatchEnd: 42,
        startedAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:10:00.000Z',
        completedAt: '2026-06-04T10:10:00.000Z',
      },
      indexSyncStatus: 'pending',
      mongoChunkCount: 0,
      pineconeVectorCount: 0,
      lastIndexedAt: undefined,
      indexSyncError: undefined,
    },
  });

  assert.equal(summary.id, '507f1f77bcf86cd799439011');
  assert.equal(summary.ocrStatus, 'pending_review');
  assert.equal(summary.ocrAverageConfidence, 0.93);
  assert.equal(summary.ocrPageCount, 42);
  assert.equal(summary.indexSyncStatus, 'pending');
  assert.equal(summary.ocrProgress.processedPages, 42);
});

test('negative OCR_MAX_PAGES fails config validation', () => {
  const result = envSchema.safeParse({
    ...process.env,
    MONGODB_URI: 'mongodb://localhost:27017/test',
    JWT_ACCESS_SECRET: '12345678901234567890123456789012',
    JWT_REFRESH_SECRET: '12345678901234567890123456789012',
    OCR_MAX_PAGES: '-1',
  });

  assert.equal(result.success, false);
});

test('invalid OCR batch size fails config validation', () => {
  const result = envSchema.safeParse({
    ...process.env,
    MONGODB_URI: 'mongodb://localhost:27017/test',
    JWT_ACCESS_SECRET: '12345678901234567890123456789012',
    JWT_REFRESH_SECRET: '12345678901234567890123456789012',
    OCR_BATCH_SIZE: '0',
  });

  assert.equal(result.success, false);
});
