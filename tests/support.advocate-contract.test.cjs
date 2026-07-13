const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_CONSENT_FLAGS, CONSENT_FLAGS } = require('../src/modules/consent/consent.constants.ts');
const {
  advocateProfileSchema,
  advocateQuerySchema,
  advocateRequestSchema,
  updateAdvocateRequestSchema
  , ownedAdvocateRequestQuerySchema,
  cancelAdvocateRequestSchema
} = require('../src/modules/support/support.schema.ts');

test('advocate request consent is a first-class stored consent flag', () => {
  assert.equal(CONSENT_FLAGS.includes('advocate_request'), true);
  assert.equal(DEFAULT_CONSENT_FLAGS.advocate_request, false);
});

test('public advocate filters accept persisted matching dimensions', () => {
  const query = advocateQuerySchema.parse({
    language: 'en',
    region: 'national',
    issueType: 'migrant_challenges',
    culturalProfile: 'new_arrival',
    faithProfile: 'muslim',
    availability: 'request_based'
  });

  assert.equal(query.issueType, 'migrant_challenges');
  assert.equal(query.availability, 'request_based');
});

test('public advocate filters reject display labels instead of canonical language ids', () => {
  const result = advocateQuerySchema.safeParse({
    language: 'English'
  });

  assert.equal(result.success, false);
});

test('advocate profile schema requires persisted management fields', () => {
  const result = advocateProfileSchema.safeParse({
    key: 'community_advocate',
    displayName: 'Community Advocate',
    publicBio: 'Safe public profile copy.',
    languages: ['en', 'ar'],
    regions: ['national'],
    issueTypes: ['general_support', 'racial_abuse'],
    culturalProfiles: ['new_arrival'],
    faithProfiles: ['muslim'],
    availability: 'limited',
    isActive: true,
    isPublished: false,
    optInStatus: 'pending',
    vetting: {
      status: 'pending',
      notes: 'Pending internal review.'
    },
    trainingCredentials: [{ title: 'Trauma-informed support' }]
  });

  assert.equal(result.success, true);
});

test('advocate request schema preserves route compatibility and supports profile keys', () => {
  const request = advocateRequestSchema.parse({
    advocateType: 'general_support',
    advocateKey: 'general_support',
    language: 'en',
    issueType: 'general_support',
    region: 'national',
    safeContactPreference: 'in_app',
    confirmationCopy: 'Consent copy'
  });

  assert.equal(request.advocateType, 'general_support');
  assert.equal(request.advocateKey, 'general_support');
});

test('admin request updates are limited to assignment, status, and short note', () => {
  const result = updateAdvocateRequestSchema.safeParse({
    status: 'closed',
    assignedAdvocateProfileId: '0123456789abcdef01234567',
    note: 'Closed after admin review.',
    noteAction: 'close',
    safeContactPreference: 'phone'
  });

  assert.equal(result.success, true);
  assert.equal(result.data.noteAction, 'close');
  assert.equal(result.data.safeContactPreference, undefined);

  const excessiveNote = updateAdvocateRequestSchema.safeParse({
    note: 'x'.repeat(1001),
    noteAction: 'assign'
  });

  assert.equal(excessiveNote.success, false);
});

test('owned advocate request query and cancellation schemas are bounded', () => {
  const query = ownedAdvocateRequestQuerySchema.parse({
    activeOnly: 'true',
    limit: '10'
  });
  const cancel = cancelAdvocateRequestSchema.parse({});

  assert.equal(query.activeOnly, true);
  assert.equal(query.limit, 10);
  assert.equal(cancel.reasonCode, 'user_cancelled');
});
