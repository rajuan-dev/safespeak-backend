const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConversationFlowCategoryLabel,
  buildConversationAssistantResponseMeta,
  buildConversationFlowPresentation,
  buildSuggestedMicroCardTitles,
  buildSupportResourceSuggestions,
  buildRelatedIssueTypes,
  detectTriageHandoffIntent,
  detectCategory,
  extractStructuredTriageFacts,
} = require('../src/modules/conversation-flow/conversation-flow.service.ts');

test('explicit triage handoff phrases trigger the triage button intent', () => {
  [
    'give me the triage button',
    'give me the trige button',
    'show recommended steps',
    'continue to next steps',
    'support summary',
    'triage page',
    'continue trige page',
    'give me triage'
  ].forEach((message) => {
    assert.equal(detectTriageHandoffIntent(message), true);
  });
});

test('triage handoff response meta preserves the same session and hides sources', () => {
  const responseMeta = buildConversationAssistantResponseMeta({
    assistantPayload: {
      assistantMessage: 'Of course — I can take you to your triage summary now.',
      nextQuestion: '',
      triageReady: true,
      nextAction: 'show_triage_button',
      showSources: false,
      sourceDisplayReason: 'triage_handoff',
      citations: [],
      reviewStatus: 'triage_handoff',
      rag: {
        used: false,
        unavailable: false,
        resultCount: 0
      }
    },
    conversationSessionId: 'session-123',
    offerTriage: true
  });

  assert.equal(responseMeta.triageReady, true);
  assert.equal(responseMeta.nextAction, 'show_triage_button');
  assert.equal(responseMeta.conversationSessionId, 'session-123');
  assert.equal(responseMeta.showSources, false);
  assert.equal(responseMeta.sourceDisplayReason, 'triage_handoff');
  assert.equal(responseMeta.citations.length, 0);
});

test('supportive conversation responses keep citations hidden even when backend citations exist', () => {
  const responseMeta = buildConversationAssistantResponseMeta({
    assistantPayload: {
      assistantMessage:
        'I am sorry this happened. If it feels safe, save screenshots and think about whether you want platform or privacy support next.',
      nextQuestion: 'Would you like help with evidence or support options first?',
      citations: [
        {
          title: 'Privacy Act 1988',
          sectionRef: 'Section 6',
          url: 'https://example.test/privacy-act-section-6',
        },
      ],
      rag: {
        used: true,
        unavailable: false,
        resultCount: 1,
      },
      reviewStatus: 'grounded_support',
    },
    conversationSessionId: 'session-support',
    offerTriage: false,
  });

  assert.equal(responseMeta.showSources, false);
  assert.equal(responseMeta.sourceDisplayReason, 'hidden_support_reply');
  assert.equal(responseMeta.conversationSessionId, 'session-support');
});

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
  const guideTitles = buildSuggestedMicroCardTitles({
    likelyCategory: detection.category,
    safetyRiskLevel: 'high',
    structuredFacts,
  });
  const relatedIssueTypes = buildRelatedIssueTypes(
    detection.category,
    structuredFacts
  );

  assert.equal(detection.category, 'online_abuse');
  assert.notEqual(detection.category, 'workplace_bullying');
  assert.equal(presentation.title, 'Image-Based Abuse & Online Threat Support');
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
  assert.ok(guideTitles.includes('Image-Based Abuse and Private Photos'));
  assert.ok(guideTitles.includes('Online Blackmail or Threats'));
  assert.ok(guideTitles.includes('Protect Your Identity After a Scam'));
  assert.ok(guideTitles.includes('What to Do After a Data Breach'));
  assert.ok(guideTitles.includes('Saving Evidence Safely'));
  assert.ok(guideTitles.includes('Privacy Complaint Steps'));
  assert.ok(guideTitles.includes('Employer Sharing Health Information'));
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
  assert.equal(label, 'Scam & Identity Risk Support');
  assert.match(presentation.primaryStepTitle, /Secure accounts|Protect/i);
});

test('public transport racial abuse stays in racism and discrimination support', () => {
  const text =
    'A man on the train shouted racist abuse at me because of my hijab and threatened me when I moved away.';

  const structuredFacts = extractStructuredTriageFacts({ text, jurisdiction: 'AU' });
  const detection = detectCategory({ text, structuredFacts });
  const label = buildConversationFlowCategoryLabel(
    detection.category,
    structuredFacts
  );
  const supportSuggestions = buildSupportResourceSuggestions({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'high',
    jurisdiction: 'AU',
  });

  assert.equal(detection.category, 'racism_discrimination');
  assert.equal(structuredFacts.racismDiscrimination, true);
  assert.match(label, /Racial|Discrimination|Hate/i);
  assert.ok(
    supportSuggestions.some((item) =>
      /Human Rights|Anti-Discrimination/i.test(item.title)
    )
  );
});

test('social media hate campaign keeps racism support while adding online safety options', () => {
  const text =
    'A group on Instagram and TikTok is posting racist hate about me, sending death threats, and sharing screenshots of my messages.';

  const structuredFacts = extractStructuredTriageFacts({
    text,
    facts: { evidenceMentioned: 'screenshots of posts and messages' },
  });
  const detection = detectCategory({ text, structuredFacts });
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
  const supportSuggestions = buildSupportResourceSuggestions({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'high',
    jurisdiction: 'AU',
  });

  assert.equal(detection.category, 'racism_discrimination');
  assert.equal(structuredFacts.racismDiscrimination, true);
  assert.equal(structuredFacts.threatsPresent, true);
  assert.ok(structuredFacts.platforms.length > 0);
  assert.match(presentation.secondBody, /eSafety|anti-discrimination|report/i);
  assert.ok(
    supportSuggestions.some((item) => /eSafety/i.test(item.title))
  );
});

test('fake immigration service scam includes migration support and guide titles', () => {
  const text =
    'A fake migration agent said they can fix my visa if I pay now and asked for my passport, bank details, and personal documents.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });
  const guideTitles = buildSuggestedMicroCardTitles({
    likelyCategory: detection.category,
    safetyRiskLevel: 'medium',
    structuredFacts,
  });
  const supportSuggestions = buildSupportResourceSuggestions({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'medium',
    jurisdiction: 'NSW',
  });

  assert.equal(detection.category, 'scam_fraud');
  assert.equal(structuredFacts.migrationOrVisaThreat, true);
  assert.ok(guideTitles.includes('Migration or Visa Pressure'));
  assert.ok(guideTitles.includes('Protect Your Identity After a Scam'));
  assert.ok(
    supportSuggestions.some((item) => /Home Affairs visa scam guidance/i.test(item.title))
  );
  assert.ok(
    supportSuggestions.some((item) => /registered agent/i.test(item.title))
  );
});

test('domestic violence with migration threat prioritises safety and consent-aware supports', () => {
  const text =
    'My partner says he will cancel my visa if I leave, controls my phone, and threatens me at home.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });
  const guideTitles = buildSuggestedMicroCardTitles({
    likelyCategory: detection.category,
    safetyRiskLevel: 'high',
    structuredFacts,
  });
  const supportSuggestions = buildSupportResourceSuggestions({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'high',
    jurisdiction: 'NSW',
  });
  const respectSuggestion = supportSuggestions.find((item) =>
    /1800RESPECT/i.test(item.title)
  );

  assert.equal(detection.category, 'domestic_violence');
  assert.ok(guideTitles.includes('Domestic Violence Safety Planning'));
  assert.ok(guideTitles.includes('Migration or Visa Pressure'));
  assert.ok(
    supportSuggestions.some((item) => /Legal Aid NSW/i.test(item.title))
  );
  assert.ok(
    supportSuggestions.some((item) => /Home Affairs visa scam guidance/i.test(item.title))
  );
  assert.ok(respectSuggestion);
  assert.match(respectSuggestion.whySuggested, /Suggested because/i);
  assert.match(respectSuggestion.consentNote, /SafeSpeak/i);
});

test('elder medicare scam adds elder and identity supports', () => {
  const text =
    'My elderly father gave his Medicare details, bank code, and date of birth to a scam caller who said his account would be suspended.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });
  const guideTitles = buildSuggestedMicroCardTitles({
    likelyCategory: detection.category,
    safetyRiskLevel: 'medium',
    structuredFacts,
  });
  const supportSuggestions = buildSupportResourceSuggestions({
    category: detection.category,
    facts: structuredFacts,
    riskLevel: 'medium',
    jurisdiction: 'AU',
  });

  assert.equal(detection.category, 'scam_fraud');
  assert.equal(structuredFacts.elderOrVulnerablePerson, true);
  assert.ok(guideTitles.includes('Elder Scam and Identity Safety'));
  assert.ok(
    supportSuggestions.some((item) => /elder support line/i.test(item.title))
  );
  assert.ok(
    supportSuggestions.some((item) => /ReportCyber/i.test(item.title))
  );
});

test('ambiguous low-detail report stays in broad review mode', () => {
  const text =
    'Something upsetting happened and I do not know what category it fits into yet.';

  const structuredFacts = extractStructuredTriageFacts({ text });
  const detection = detectCategory({ text, structuredFacts });

  assert.equal(detection.category, 'general_support');
  assert.ok(detection.confidenceScore <= 0.42);
});
