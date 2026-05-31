const assert = require('node:assert/strict');
const test = require('node:test');

const {
  knowledgeSourceChunkQuerySchema
} = require('../src/modules/rag/rag.schema.ts');

test('knowledge source chunk preview pagination defaults to page 1 and limit 25', () => {
  const parsed = knowledgeSourceChunkQuerySchema.parse({});

  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 25);
});

test('knowledge source chunk preview pagination caps the limit at 50', () => {
  const parsed = knowledgeSourceChunkQuerySchema.safeParse({
    page: '2',
    limit: '999'
  });

  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /50/);
});
