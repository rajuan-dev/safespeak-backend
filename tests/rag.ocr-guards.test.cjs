const assert = require('node:assert/strict');
const test = require('node:test');

const { env } = require('../src/config/env.ts');
const {
  shouldRequireOcrForExtraction,
  assessOcrOutputQuality,
  isOcrSourceRetrievable,
} = require('../src/modules/rag/rag.service.ts');

const originalEnv = {
  OCR_MIN_CONFIDENCE: env.OCR_MIN_CONFIDENCE,
};

test.after(() => {
  env.OCR_MIN_CONFIDENCE = originalEnv.OCR_MIN_CONFIDENCE;
});

test('text PDF extraction with strong text quality bypasses OCR', () => {
  assert.equal(
    shouldRequireOcrForExtraction({
      text: [
        'This Act sets out offences, penalties, procedures, and definitions for the purposes of the statute.',
        'It also explains jurisdiction, review pathways, and enforcement powers in ordinary legislative language.',
        'The extracted text is long enough and clean enough that OCR should not be required.'
      ].join(' '),
      extractor: 'pdf-parse',
      mimeType: 'application/pdf',
      fileName: 'legislation.pdf',
    }),
    false
  );
});

test('scanned PDF extraction becomes OCR-required when text is empty', () => {
  assert.equal(
    shouldRequireOcrForExtraction({
      text: '',
      extractor: 'pdf-parse',
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
    }),
    true
  );
});

test('image uploads are OCR-required when no text was extracted directly', () => {
  assert.equal(
    shouldRequireOcrForExtraction({
      text: '',
      extractor: 'image-upload',
      mimeType: 'image/png',
      fileName: 'evidence.png',
    }),
    true
  );
});

test('low-confidence OCR output fails quality checks and stays out of indexing', () => {
  env.OCR_MIN_CONFIDENCE = 0.85;
  const assessment = assessOcrOutputQuality({
    text: 'Readable looking OCR text but the recognizer was unsure across the page.',
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text: 'Readable looking OCR text but the recognizer was unsure across the page.',
        confidence: 0.52,
        warnings: [],
      },
    ],
    averageConfidence: 0.52,
    provider: 'tesseract',
    language: 'eng',
    extractionMethod: 'ocr',
    warnings: [],
  });

  assert.equal(assessment.passed, false);
  assert.equal(assessment.status, 'low_confidence');
  assert.match(assessment.reason, /below the configured minimum/i);
});

test('garbage OCR output fails instead of polluting vectors', () => {
  env.OCR_MIN_CONFIDENCE = 0.5;
  const assessment = assessOcrOutputQuality({
    text: Array.from({ length: 30 }, () => '@@@ ### ??? %% ^^').join(' '),
    pageCount: 2,
    pages: [
      {
        pageNumber: 1,
        text: Array.from({ length: 12 }, () => '@@@ ### ??? %% ^^').join(' '),
        confidence: 0.98,
        warnings: [],
      },
      {
        pageNumber: 2,
        text: Array.from({ length: 12 }, () => '??? %% ^^ @@@ ###').join(' '),
        confidence: 0.97,
        warnings: [],
      },
    ],
    averageConfidence: 0.975,
    provider: 'tesseract',
    language: 'eng',
    extractionMethod: 'ocr',
    warnings: [],
  });

  assert.equal(assessment.passed, false);
  assert.equal(assessment.status, 'failed');
  assert.equal(assessment.garbageLikely, true);
});

test('high-confidence OCR output passes quality checks', () => {
  env.OCR_MIN_CONFIDENCE = 0.85;
  const assessment = assessOcrOutputQuality({
    text: [
      'Section 1 Preliminary. Section 2 Definitions. A person must not publish the protected material without consent.',
      'Section 3 Application. This Act applies to conduct occurring through online services, shared storage, or other digital systems.',
      'Section 4 Complaints. A person affected by a disclosure may seek review, support, or another official pathway described in the legislation.'
    ].join(' '),
    pageCount: 2,
    pages: [
      {
        pageNumber: 1,
        text: 'Section 1 Preliminary. Section 2 Definitions.',
        confidence: 0.96,
        warnings: [],
      },
      {
        pageNumber: 2,
        text: 'A person must not publish the protected material without consent.',
        confidence: 0.94,
        warnings: [],
      },
    ],
    averageConfidence: 0.95,
    provider: 'tesseract',
    language: 'eng',
    extractionMethod: 'ocr',
    warnings: [],
  });

  assert.equal(assessment.passed, true);
  assert.equal(assessment.status, 'completed');
});

test('legal OCR sources stay blocked from retrieval until reviewed', () => {
  env.OCR_MIN_CONFIDENCE = 0.85;

  assert.equal(
    isOcrSourceRetrievable({
      extractionMethod: 'ocr',
      ocrReviewRequired: true,
      ocrStatus: 'completed',
      ocrAverageConfidence: 0.94,
    }),
    false
  );

  assert.equal(
    isOcrSourceRetrievable({
      extractionMethod: 'ocr',
      ocrReviewRequired: true,
      ocrStatus: 'reviewed',
      ocrAverageConfidence: 0.94,
    }),
    true
  );
});

test('non-OCR sources remain retrievable without OCR review metadata', () => {
  assert.equal(
    isOcrSourceRetrievable({
      extractionMethod: 'text',
    }),
    true
  );
});
