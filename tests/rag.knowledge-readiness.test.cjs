const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getKnowledgeSourceApprovalBlocker
} = require('../src/modules/rag/rag.service.ts');
const {
  RAG_OFFICIAL_SOURCE_HOSTS,
  RAG_REQUIRED_LEGAL_JURISDICTIONS
} = require('../src/modules/rag/rag.constants.ts');

test('official legal knowledge sources require legal review before approval', () => {
  const blocker = getKnowledgeSourceApprovalBlocker({
    sourceCategory: 'official_legal_source',
    legalReviewed: false,
    status: 'pending_review'
  });

  assert.equal(blocker?.code, 'legal_review_missing');
  assert.equal(blocker?.statusCode, 403);
});

test('official support knowledge sources do not require legal review before approval', () => {
  const blocker = getKnowledgeSourceApprovalBlocker(
    {
      sourceCategory: 'official_support_source',
      legalReviewed: false,
      status: 'pending_review',
      nextRefreshAt: new Date('2026-12-31T00:00:00.000Z')
    },
    new Date('2026-05-25T00:00:00.000Z')
  );

  assert.equal(blocker, undefined);
});

test('expired official refresh dates block knowledge source approval', () => {
  const blocker = getKnowledgeSourceApprovalBlocker(
    {
      sourceCategory: 'official_legal_source',
      legalReviewed: true,
      status: 'pending_review',
      nextRefreshAt: new Date('2026-05-24T00:00:00.000Z')
    },
    new Date('2026-05-25T00:00:00.000Z')
  );

  assert.equal(blocker?.code, 'refresh_expired');
  assert.equal(blocker?.statusCode, 409);
});

test('failed or partially indexed knowledge sources cannot be approved', () => {
  const failedBlocker = getKnowledgeSourceApprovalBlocker({
    sourceCategory: 'official_legal_source',
    ingestionStatus: 'failed',
    legalReviewed: true,
    status: 'pending_review'
  });
  const partialBlocker = getKnowledgeSourceApprovalBlocker({
    sourceCategory: 'official_legal_source',
    ingestionStatus: 'partial_index_failed',
    legalReviewed: true,
    status: 'pending_review'
  });

  assert.equal(failedBlocker?.code, 'ingestion_failed');
  assert.equal(failedBlocker?.statusCode, 409);
  assert.equal(partialBlocker?.code, 'ingestion_failed');
  assert.equal(partialBlocker?.statusCode, 409);
});

test('trusted public legal aid hosts remain allow-listed for official source ingestion', () => {
  assert.equal(RAG_OFFICIAL_SOURCE_HOSTS.includes('familyviolencelaw.gov.au'), true);
  assert.equal(RAG_OFFICIAL_SOURCE_HOSTS.includes('aihw.gov.au'), true);
});

test('required legal jurisdiction coverage includes all Australian jurisdictions and Commonwealth', () => {
  assert.deepEqual(RAG_REQUIRED_LEGAL_JURISDICTIONS, [
    'Cth',
    'NSW',
    'VIC',
    'QLD',
    'SA',
    'WA',
    'TAS',
    'NT',
    'ACT'
  ]);
});
