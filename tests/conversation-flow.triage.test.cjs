const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConversationFlowCategoryLabel,
  buildConversationFlowPresentation,
  buildRelatedIssueTypes,
  detectCategory,
  extractStructuredTriageFacts,
} = require('../src/modules/conversation-flow/conversation-flow.service.ts');

test('mixed privacy scam conversation prioritises cyber/privacy triage over workplace bullying', () => {
  const text = [
    'Someone shared my private photos without permission.',
    'A company leaked my personal details.',
    'A scammer got my ID and bank details.',
    'My employer shared my health information.',
    'They threatened to publish my private messages.',
    'I have screenshots and emails.',
  ].join(' ');

  const structuredFacts = extractStructuredTriageFacts({
    text,
    facts: { evidenceMentioned: 'screenshots and emails' },
    jurisdiction: 'AU',
  });
  const detection = detectCategory({
    text,
    structuredFacts,
  });
  const label = buildConversationFlowCategoryLabel(
    detection.category,
    structuredFacts
  );
  const presentation = buildConversationFlowPresentation({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'high',
    label,
  });
  const relatedIssueTypes = buildRelatedIssueTypes(
    detection.category,
    structuredFacts
  );

  assert.equal(detection.category, 'online_abuse');
  assert.notEqual(detection.category, 'workplace_bullying');
  assert.equal(structuredFacts.privacyDataBreach, true);
  assert.equal(structuredFacts.identityTheftRisk, true);
  assert.equal(structuredFacts.scamFraud, true);
  assert.equal(structuredFacts.imageBasedAbuse, true);
  assert.equal(structuredFacts.onlineThreatBlackmail, true);
  assert.equal(structuredFacts.employerHealthPrivacy, true);
  assert.match(label, /Privacy|Cyber Safety|Online Threat|Image-Based Abuse/i);
  assert.match(
    presentation.primaryStepBody,
    /bank|password|identity|codes/i
  );
  assert.match(
    presentation.secondBody,
    /platform|company|privacy complaint|OAIC/i
  );
  assert.match(
    presentation.thirdBody,
    /workplace privacy|who shared|received it/i
  );
  assert.deepEqual(
    relatedIssueTypes.slice(0, 1),
    ['online_abuse']
  );
  assert.ok(relatedIssueTypes.includes('scam_fraud'));
  assert.ok(!relatedIssueTypes.includes('workplace_bullying'));
});

test('pure workplace bullying stays in workplace bullying support', () => {
  const text =
    'My manager humiliates me in meetings, my coworkers harass me, and there is constant workplace pressure.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });
  const presentation = buildConversationFlowPresentation({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'medium',
    label: buildConversationFlowCategoryLabel(detection.category, structuredFacts),
  });

  assert.equal(detection.category, 'workplace_bullying');
  assert.equal(presentation.title, 'Workplace Bullying Support');
});

test('employer health information only becomes workplace privacy concern instead of bullying', () => {
  const text =
    'My employer shared my health information without asking me and I have the email.';

  const structuredFacts = extractStructuredTriageFacts({
    text,
    facts: { evidenceMentioned: 'email' },
  });
  const detection = detectCategory({ text, structuredFacts });
  const label = buildConversationFlowCategoryLabel(
    detection.category,
    structuredFacts
  );
  const presentation = buildConversationFlowPresentation({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'low',
    label,
  });
  const relatedIssueTypes = buildRelatedIssueTypes(
    detection.category,
    structuredFacts
  );

  assert.notEqual(detection.category, 'workplace_bullying');
  assert.equal(label, 'Workplace Privacy Concern');
  assert.equal(presentation.title, 'Workplace Privacy Concern');
  assert.match(presentation.secondBody, /what information was disclosed|privacy/i);
  assert.ok(!relatedIssueTypes.includes('workplace_bullying'));
});

test('domestic violence is prioritised when partner threats and violence are present', () => {
  const text = 'My partner threatened me and hit me. I am scared to go home.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });

  assert.equal(detection.category, 'domestic_violence');
});

test('scam only conversation becomes scam and identity risk support', () => {
  const text = 'A scammer got my bank details and ID through a fake link.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });
  const label = buildConversationFlowCategoryLabel(
    detection.category,
    structuredFacts
  );
  const presentation = buildConversationFlowPresentation({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'medium',
    label,
  });

  assert.equal(detection.category, 'scam_fraud');
  assert.equal(label, 'Scam & Identity Risk');
  assert.match(presentation.primaryStepTitle, /Secure accounts|Protect/i);
});
