const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createKnowledgeSourceSchema,
  ragSearchSchema
} = require('../src/modules/rag/rag.schema.ts');
const {
  normalizeKnowledgeSourceInput,
  normalizeKnowledgeSourceMetadata,
  normalizeLegalDomainValue,
  normalizePathwayCategoryValue,
  normalizeStateOrTerritoryValue
} = require('../src/modules/rag/rag.normalization.ts');

const baseSource = {
  title: 'NSW test source',
  sourceCategory: 'official_legal_source',
  jurisdiction: 'NSW',
  sourceType: 'Act',
  publisher: 'NSW Legislation',
  licenseStatus: 'Government copyright',
  lastUpdated: '2026-05-31T00:00:00.000Z',
  nextRefreshAt: '2026-12-31T00:00:00.000Z'
};

test('knowledge source topic aliases normalize to backend canonical values', () => {
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      topic: 'domestic_violence'
    }).topic,
    'dv'
  );
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      topic: 'racial_abuse'
    }).topic,
    'racial'
  );
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      topic: 'cyber_scam'
    }).topic,
    'scam'
  );
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      topic: 'migrant_challenges'
    }).topic,
    'migrant'
  );
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      topic: 'resources'
    }).topic,
    'support'
  );
});

test('knowledge source sourceCategory aliases normalize to backend canonical values', () => {
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      sourceCategory: 'Legislation',
      topic: 'dv'
    }).sourceCategory,
    'official_legal_source'
  );
  assert.equal(
    createKnowledgeSourceSchema.parse({
      ...baseSource,
      sourceCategory: 'Support',
      topic: 'support'
    }).sourceCategory,
    'official_support_source'
  );
});

test('search topic aliases use the same normalization', () => {
  assert.equal(
    ragSearchSchema.parse({
      query: 'domestic violence options',
      topic: 'domestic_violence'
    }).topic,
    'dv'
  );
  assert.equal(
    ragSearchSchema.parse({
      query: 'legal options',
      sourceCategory: 'legislation'
    }).sourceCategory,
    'official_legal_source'
  );
});

test('invalid topics report accepted values', () => {
  const result = createKnowledgeSourceSchema.safeParse({
    ...baseSource,
    topic: 'unknown_category'
  });

  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Accepted values:/);
  assert.match(result.error.issues[0].message, /domestic_violence/);
  assert.match(result.error.issues[0].message, /dv/);
});

test('normalization keeps adminCategory display labels stable', () => {
  assert.deepEqual(
    normalizeKnowledgeSourceMetadata({ adminCategory: 'scam_pattern' }),
    {
      adminCategory: 'Scam Pattern',
      stateOrTerritory: undefined,
      legalDomain: undefined,
      pathwayCategory: undefined
    }
  );
  assert.equal(
    normalizeKnowledgeSourceInput({
      ...baseSource,
      sourceCategory: 'regulation',
      topic: 'cyber_scam',
      metadata: { adminCategory: 'legislation' }
    }).metadata.adminCategory,
    'Legislation'
  );
});

test('state, legalDomain, and pathwayCategory normalize to canonical values', () => {
  assert.equal(normalizeStateOrTerritoryValue('commonwealth'), 'FEDERAL');
  assert.equal(normalizeLegalDomainValue('online abuse'), 'online_safety');
  assert.equal(normalizePathwayCategoryValue('evidence'), 'evidence_guidance');
});
