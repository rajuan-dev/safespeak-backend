const assert = require('node:assert/strict');
const test = require('node:test');

const {
  taxonomySchema,
  updateTaxonomySchema
} = require('../src/modules/admin/admin.schema.ts');

test('taxonomySchema accepts documented admin taxonomy types', () => {
  const incidentType = taxonomySchema.safeParse({
    type: 'incident_type',
    key: 'online_harassment',
    label: 'Online Harassment',
    description: 'Harassment reported through digital channels.',
    isActive: true
  });
  const triageLabel = taxonomySchema.safeParse({
    type: 'support_need',
    key: 'legal_support',
    label: 'Legal Support',
    isActive: true
  });

  assert.equal(incidentType.success, true);
  assert.equal(triageLabel.success, true);
});

test('taxonomySchema rejects blank label and blank key values', () => {
  const blankLabel = taxonomySchema.safeParse({
    type: 'incident_type',
    key: 'online_harassment',
    label: '   '
  });
  const blankKey = taxonomySchema.safeParse({
    type: 'support_need',
    key: '   ',
    label: 'Legal Support'
  });

  assert.equal(blankLabel.success, false);
  assert.equal(blankKey.success, false);
});

test('taxonomySchema rejects keys outside lower snake case format', () => {
  for (const key of ['OnlineHarassment', 'online harassment', 'online-harassment', '_online', 'online_', 'online__harassment']) {
    const result = taxonomySchema.safeParse({
      type: 'incident_type',
      key,
      label: 'Online Harassment'
    });

    assert.equal(result.success, false, `${key} should be rejected`);
  }
});

test('updateTaxonomySchema permits editable fields only', () => {
  const editableResult = updateTaxonomySchema.safeParse({
    label: 'Updated Label',
    description: 'Updated description',
    isActive: false
  });
  const keyRenameResult = updateTaxonomySchema.safeParse({
    key: 'renamed_key'
  });
  const typeChangeResult = updateTaxonomySchema.safeParse({
    type: 'language'
  });

  assert.equal(editableResult.success, true);
  assert.equal(keyRenameResult.success, false);
  assert.equal(typeChangeResult.success, false);
});
