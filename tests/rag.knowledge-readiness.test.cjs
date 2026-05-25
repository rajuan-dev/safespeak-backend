const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getKnowledgeSourceApprovalBlocker
} = require('../src/modules/rag/rag.service.ts');

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
