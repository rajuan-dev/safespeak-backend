const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAssistantSourceDisplayMeta,
  buildGroundedDefinitionAnswer,
  buildGroundedLegalNotFoundAnswer,
  buildGroundedSectionAnswer,
  buildFocusedLegalSearchQuery,
  classifySourceCategory,
  detectLegalHeading,
} = require('../src/modules/rag/rag.service.ts');

test('legislation heading parser ignores running headers and page numbers', () => {
  assert.equal(detectLegalHeading('26 Privacy Act 1988'), undefined);
  assert.equal(detectLegalHeading('Privacy Act 1988 85'), undefined);
  assert.equal(
    detectLegalHeading(
      '13G Civil penalty provision for serious interference with privacy of an individual'
    )?.sectionNumber,
    '13G'
  );
});

test('privacy act lookups classify as official legal source queries', () => {
  assert.equal(
    classifySourceCategory({ query: 'personal information', topK: 5 }),
    'official_legal_source'
  );
  assert.equal(
    classifySourceCategory({ query: 'Australian Privacy Principles', topK: 5 }),
    'official_legal_source'
  );
  assert.equal(
    classifySourceCategory({
      query: 'interference with privacy of individuals',
      topK: 5,
    }),
    'official_legal_source'
  );
});

test('focused legal search query removes framing around section questions', () => {
  assert.equal(
    buildFocusedLegalSearchQuery(
      'According to the uploaded Privacy Act 1988, what section deals with serious interference with privacy?'
    ),
    'serious interference with privacy'
  );
});

test('grounded section answers stay human and keep the correct section', () => {
  const answer = buildGroundedSectionAnswer(
    'According to the uploaded Privacy Act 1988, what section deals with serious interference with privacy?',
    [
      {
        title: 'Privacy Act 1988',
        sectionRef: 'Section 13G',
        text: '13G Civil penalty provision for serious interference with privacy of an individual'
      }
    ]
  );

  assert.match(answer, /^Yes — under the Privacy Act 1988,/);
  assert.match(answer, /\bsection 13G\b/);
  assert.match(answer, /In simple terms, this section is about serious interference with privacy\./);
});

test('grounded definition answers stay plain and cite the correct section', () => {
  const answer = buildGroundedDefinitionAnswer('What is personal information under the Privacy Act 1988?', [
    {
      title: 'Privacy Act 1988',
      sectionRef: 'Section 6',
      text:
        'personal information means information or an opinion about an identified individual, or an individual who is reasonably identifiable, whether the information or opinion is true or not, and whether the information or opinion is recorded in a material form or not'
    }
  ]);

  assert.match(answer, /^Under the Privacy Act 1988, section 6 says personal information means/i);
  assert.match(answer, /In simple terms, this is the definition the source gives for that term\./);
});

test('assistant source display meta shows compact legal footers only for grounded legal lookups', () => {
  const legalLookup = buildAssistantSourceDisplayMeta({
    message: 'What is personal information under the Privacy Act 1988?',
    citations: [
      {
        title: 'Privacy Act 1988',
        sectionRef: 'Section 6',
        url: 'https://example.test/privacy-act-section-6'
      }
    ]
  });
  const explicitCitationRequest = buildAssistantSourceDisplayMeta({
    message:
      'According to the uploaded Privacy Act 1988, what section deals with serious interference with privacy?',
    citations: [
      {
        title: 'Privacy Act 1988',
        sectionRef: 'Section 13G',
        url: 'https://example.test/privacy-act-section-13g'
      }
    ]
  });
  const supportiveReply = buildAssistantSourceDisplayMeta({
    message: 'Someone shared my private photos.',
    citations: [
      {
        title: 'Privacy Act 1988',
        sectionRef: 'Section 6',
        url: 'https://example.test/privacy-act-section-6'
      }
    ]
  });
  const notGrounded = buildAssistantSourceDisplayMeta({
    message: 'What prison sentence does the Privacy Act give for domestic violence?',
    citations: []
  });

  assert.deepEqual(legalLookup, {
    showSources: true,
    sourceDisplayReason: 'legal_lookup'
  });
  assert.deepEqual(explicitCitationRequest, {
    showSources: true,
    sourceDisplayReason: 'explicit_citation_request'
  });
  assert.deepEqual(supportiveReply, {
    showSources: false,
    sourceDisplayReason: 'hidden_support_reply'
  });
  assert.deepEqual(notGrounded, {
    showSources: false,
    sourceDisplayReason: 'not_directly_grounded'
  });
});

test('grounded not-found answers stay supportive for irrelevant domestic violence sentencing questions', () => {
  const answer = buildGroundedLegalNotFoundAnswer(
    'What prison sentence does the Privacy Act give for domestic violence?',
    'Privacy Act 1988',
    'prison sentence for domestic violence'
  );

  assert.match(answer, /couldn't find anything in the Privacy Act 1988 that sets a prison sentence for domestic violence/i);
  assert.match(answer, /emergency or specialist family violence support is more appropriate/i);
});
