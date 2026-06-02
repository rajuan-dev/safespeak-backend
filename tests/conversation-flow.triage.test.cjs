const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConversationFlowCategoryLabel,
  buildConversationAssistantResponseMeta,
  buildConversationFlowPresentation,
  buildInternalPathways,
  buildIntakePlanner,
  buildStructuredReportPreparation,
  buildSuggestedMicroCardTitles,
  buildSupportResourceSuggestions,
  buildRelatedIssueTypes,
  buildSafetySteps,
  buildSupportReply,
  classifyResponseMode,
  detectAssistantLanguage,
  detectTriageHandoffIntent,
  detectCategory,
  evaluateSafetyOverride,
  extractSupportFacts,
  extractStructuredTriageFacts,
  localizeKnownLegalLookupAnswer,
  shouldShowSources,
} = require('../src/modules/conversation-flow/conversation-flow.service.ts');
const {
  ASSISTANT_LANGUAGE_REGISTRY,
  resolveAssistantLanguage,
} = require('../src/modules/ai/assistant-language.ts');

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

test('dynamic support reply handles blackmail paraphrase without source footer', () => {
  const message = 'My ex says he will leak our chat unless I pay him.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const steps = buildSafetySteps(facts);
  const reply = buildSupportReply({ facts, responseMode });

  assert.equal(responseMode, 'support_victim_style');
  assert.equal(facts.threat_present, true);
  assert.equal(facts.blackmail_or_extortion, true);
  assert.equal(facts.private_photos_or_messages, true);
  assert.equal(shouldShowSources(responseMode, message, []), false);
  assert.ok(steps.some((step) => /save screenshots|links|usernames|dates/i.test(step)));
  assert.ok(steps.some((step) => /Avoid replying|negotiating/i.test(step)));
  assert.match(reply.nextQuestion, /money|contact|images|something else/i);
});

test('dynamic support reply handles online screenshot threat paraphrase', () => {
  const message = 'A stranger online is threatening to post screenshots of me.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  assert.equal(responseMode, 'support_victim_style');
  assert.equal(facts.threat_present, true);
  assert.equal(shouldShowSources(responseMode, message, []), false);
});

test('assistant language detector identifies supported scripted and spanish inputs', () => {
  assert.equal(detectAssistantLanguage('شخص يهدد بنشر رسائلي الخاصة'), 'ar');
  assert.equal(
    detectAssistantLanguage('एक नकली वीजा एजेंट ने मेरा पासपोर्ट नंबर और बैंक डिटेल ले ली'),
    'hi'
  );
  assert.equal(
    detectAssistantLanguage('একজন স্ক্যামার আমার আইডি আর ব্যাংকের তথ্য নিয়ে নিয়েছে'),
    'bn'
  );
  assert.equal(detectAssistantLanguage('有人威胁要公开我的私人信息'), 'zh-Hans');
  assert.equal(detectAssistantLanguage('有人威脅要公開我的私人信息'), 'zh-Hant');
  assert.equal(
    detectAssistantLanguage('Alguien amenaza con publicar mis mensajes privados'),
    'es'
  );
});

test('assistant language resolver falls back to english when latest message is uncertain', () => {
  assert.equal(resolveAssistantLanguage({ message: 'ok', requestedLanguage: 'en' }), 'en');
});

test('arabic support reply stays localized and source-hidden', () => {
  const message = 'شخص يهدد بنشر رسائلي الخاصة';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const reply = buildSupportReply({
    facts,
    responseMode,
    sessionContext: { language: 'ar' }
  });

  assert.equal(reply.showSources, false);
  assert.match(reply.assistantMessage, /آسف|سلامتك|خطوات/);
});

test('spanish support reply stays localized and source-hidden', () => {
  const message = 'Alguien amenaza con publicar mis mensajes privados';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const reply = buildSupportReply({
    facts,
    responseMode,
    sessionContext: { language: 'es' }
  });

  assert.equal(reply.showSources, false);
  assert.match(reply.assistantMessage, /Siento|prácticos|capturas/);
});

test('future indigenous registry entries remain disabled until reviewed', () => {
  const futureEntries = ASSISTANT_LANGUAGE_REGISTRY.filter(
    (entry) => entry.family === 'indigenous_future'
  );

  assert.ok(futureEntries.length >= 8);
  futureEntries.forEach((entry) => {
    assert.equal(entry.enabled, false);
    assert.equal(entry.humanReviewed, false);
  });
});

test('dynamic support reply handles fake visa agent scam and identity risk', () => {
  const message = 'My bank info and passport were taken by a fake visa agent.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts,
    selectedTopic: 'scamshield'
  });
  const steps = buildSafetySteps(facts);

  assert.equal(responseMode, 'scamshield_style');
  assert.equal(facts.scam_or_fraud, true);
  assert.equal(facts.bank_details_exposed, true);
  assert.equal(facts.identity_documents_exposed, true);
  assert.equal(facts.migration_or_visa_threat, true);
  assert.ok(steps.some((step) => /bank|card provider|account/i.test(step)));
  assert.ok(steps.some((step) => /passwords|two-factor/i.test(step)));
  assert.equal(shouldShowSources(responseMode, message, []), false);
});

test('clinic emailing health info to boss stays privacy-focused not bullying', () => {
  const message = 'The clinic emailed my health info to my boss.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const steps = buildSafetySteps(facts);

  assert.equal(responseMode, 'support_victim_style');
  assert.equal(facts.employer_involved, true);
  assert.equal(facts.health_information, true);
  assert.equal(facts.originalFacts.workplaceBullying, false);
  assert.ok(steps.some((step) => /who shared the health information|who received it/i.test(step)));
  assert.equal(shouldShowSources(responseMode, message, []), false);
});

test('racist abuse against family member gets evidence-oriented support reply', () => {
  const message = 'Someone yelled racist abuse at my mum outside the shop.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const steps = buildSafetySteps(facts);

  assert.equal(responseMode, 'support_victim_style');
  assert.equal(facts.racism_or_hate, true);
  assert.ok(steps.some((step) => /exact words|actions|witnesses/i.test(step)));
  assert.equal(shouldShowSources(responseMode, message, []), false);
});

test('domestic violence migration threat gets safety-first reply', () => {
  const message = 'My partner says immigration will deport me if I leave.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const reply = buildSupportReply({ facts, responseMode });

  assert.equal(responseMode, 'support_victim_style');
  assert.equal(facts.domestic_family_context, true);
  assert.equal(facts.migration_or_visa_threat, true);
  assert.match(reply.assistantMessage, /safety comes first|1800RESPECT|safe/i);
  assert.equal(shouldShowSources(responseMode, message, []), false);
});

test('legal lookup keeps compact source display path available', () => {
  const message = 'What section of the Privacy Act defines personal information?';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  assert.equal(responseMode, 'legal_lookup');
  assert.equal(
    shouldShowSources(responseMode, message, [
      {
        title: 'Privacy Act 1988',
        sectionRef: 'section 6',
        url: 'https://example.test/privacy'
      }
    ]),
    true
  );
});

test('triage command remains a hidden-source triage handoff', () => {
  const message = 'give me the trige button';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  assert.equal(responseMode, 'triage_handoff');
  assert.equal(shouldShowSources(responseMode, message, []), false);
});

test('safety override marks partner violence tonight as urgent/high safety', () => {
  const facts = extractSupportFacts({
    message: 'My partner hit me tonight and threatened me if I leave.'
  });
  const override = evaluateSafetyOverride(facts);

  assert.equal(override.safetyOverride, true);
  assert.ok(['high', 'urgent'].includes(override.safetyLevel));
  assert.ok(override.recommendedImmediateActions.some((item) => /000|1800RESPECT/i.test(item)));
});

test('safety override marks kill threat as urgent', () => {
  const facts = extractSupportFacts({
    message: 'He will kill me if I leave.'
  });
  const override = evaluateSafetyOverride(facts);

  assert.equal(override.safetyLevel, 'urgent');
});

test('dv migration threat keeps dv, coercive control, and migration safety signals', () => {
  const facts = extractSupportFacts({
    message: 'My partner says immigration will deport me if I leave and controls my phone.'
  });
  const override = evaluateSafetyOverride(facts);

  assert.equal(facts.domestic_family_context, true);
  assert.equal(facts.coercive_control, true);
  assert.equal(facts.migration_or_visa_threat, true);
  assert.equal(override.safetyOverride, true);
});

test('blackmail with private photos becomes high-risk image abuse safety override', () => {
  const facts = extractSupportFacts({
    message: 'He says he will post my private photos unless I pay him.'
  });
  const override = evaluateSafetyOverride(facts);

  assert.equal(facts.image_based_abuse, true);
  assert.equal(facts.blackmail_or_extortion, true);
  assert.equal(override.safetyLevel, 'high');
});

test('self-harm phrase triggers urgent safety support mode', () => {
  const message = 'I feel suicidal and unsafe right now.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });
  const override = evaluateSafetyOverride(facts);

  assert.equal(responseMode, 'emergency_safety');
  assert.equal(override.safetyLevel, 'urgent');
});

test('child threatened online becomes child safety risk', () => {
  const facts = extractSupportFacts({
    message: 'Someone is threatening my child online and sharing her photos.'
  });
  const override = evaluateSafetyOverride(facts);

  assert.equal(facts.child_safety_risk, true);
  assert.equal(override.safetyOverride, true);
});

test('public transport racial abuse maps to anti-discrimination pathways', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'A man on the train shouted racist abuse at me because of my hijab.'
  });
  const pathways = buildInternalPathways({
    category: 'racism_discrimination',
    facts: structuredFacts
  });

  assert.ok(pathways.some((item) => item.pathwayId === 'anti_discrimination'));
});

test('data breach maps to OAIC and organisation complaint pathways', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'A company leaked my personal details in a data breach.'
  });
  const pathways = buildInternalPathways({
    category: 'online_abuse',
    facts: structuredFacts
  });

  assert.ok(pathways.some((item) => item.pathwayId === 'oaic_privacy'));
});

test('online threat maps to esafety and platform pathways', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'Someone online is threatening to post my screenshots on Instagram.'
  });
  const pathways = buildInternalPathways({
    category: 'online_abuse',
    facts: structuredFacts
  });

  assert.ok(pathways.some((item) => item.pathwayId === 'esafety_online_abuse'));
});

test('scam maps to scamwatch reportcyber and identity support pathways', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'A scammer took my bank details and passport.'
  });
  const pathways = buildInternalPathways({
    category: 'scam_fraud',
    facts: structuredFacts
  });

  assert.ok(pathways.some((item) => item.pathwayId === 'reportcyber_scam'));
});

test('agency intake planner returns consent-required eSafety fields', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'Someone is sharing my photos on TikTok.'
  });
  const plans = buildIntakePlanner({
    pathways: buildInternalPathways({
      category: 'online_abuse',
      facts: structuredFacts
    }),
    facts: structuredFacts,
    safetyOverride: {
      safetyOverride: false,
      safetyLevel: 'none',
      safetyReasons: [],
      recommendedImmediateActions: []
    }
  });
  const plan = plans.find((item) => item.pathwayId === 'esafety_online_abuse');

  assert.ok(plan);
  assert.equal(plan.consentRequiredBeforeSharing, true);
  assert.ok(plan.requiredFields.some((field) => field.key === 'platform'));
});

test('agency intake planner returns consent-required reportcyber fields', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'A fake link scam got my bank details.'
  });
  const plan = buildIntakePlanner({
    pathways: buildInternalPathways({
      category: 'scam_fraud',
      facts: structuredFacts
    }),
    facts: structuredFacts,
    safetyOverride: {
      safetyOverride: false,
      safetyLevel: 'none',
      safetyReasons: [],
      recommendedImmediateActions: []
    }
  }).find((item) => item.pathwayId === 'reportcyber_scam');

  assert.ok(plan);
  assert.equal(plan.consentRequiredBeforeSharing, true);
  assert.ok(plan.requiredFields.some((field) => field.key === 'scam_type'));
});

test('agency intake planner returns consent-required oaic fields', () => {
  const structuredFacts = extractStructuredTriageFacts({
    text: 'My personal information was leaked by an organisation.'
  });
  const plan = buildIntakePlanner({
    pathways: buildInternalPathways({
      category: 'online_abuse',
      facts: structuredFacts
    }),
    facts: structuredFacts,
    safetyOverride: {
      safetyOverride: false,
      safetyLevel: 'none',
      safetyReasons: [],
      recommendedImmediateActions: []
    }
  }).find((item) => item.pathwayId === 'oaic_privacy');

  assert.ok(plan);
  assert.ok(plan.requiredFields.some((field) => field.key === 'organisation_name'));
});

test('support resources include language support when interpreter need is present', () => {
  const facts = extractStructuredTriageFacts({
    text: 'I need an interpreter because English is not my first language.'
  });
  const resources = buildSupportResourceSuggestions({
    category: 'general_support',
    facts,
    riskLevel: 'low',
    jurisdiction: 'AU'
  });

  assert.ok(resources.some((item) => /TIS National/i.test(item.title)));
});

test('support resources include esafety for image-based abuse', () => {
  const facts = extractStructuredTriageFacts({
    text: 'Someone shared my intimate photos online.'
  });
  const resources = buildSupportResourceSuggestions({
    category: 'online_abuse',
    facts,
    riskLevel: 'high',
    jurisdiction: 'AU'
  });

  assert.ok(resources.some((item) => /eSafety/i.test(item.title)));
});

test('support resources include oaic for privacy data breach', () => {
  const facts = extractStructuredTriageFacts({
    text: 'A company exposed my personal details.'
  });
  const resources = buildSupportResourceSuggestions({
    category: 'online_abuse',
    facts,
    riskLevel: 'medium',
    jurisdiction: 'AU'
  });

  assert.ok(resources.some((item) => /OAIC/i.test(item.title)));
});

test('support resources include 1800RESPECT and emergency for dv danger', () => {
  const facts = extractStructuredTriageFacts({
    text: 'My partner hit me and I am in immediate danger.'
  });
  const resources = buildSupportResourceSuggestions({
    category: 'domestic_violence',
    facts,
    riskLevel: 'immediate',
    jurisdiction: 'AU'
  });

  assert.ok(resources.some((item) => /1800RESPECT/i.test(item.title)));
  assert.ok(resources.some((item) => /000/i.test(item.title)));
});

test('support resources include anti-discrimination and fair work pathways where relevant', () => {
  const facts = extractStructuredTriageFacts({
    text: 'My boss used racist abuse at work.'
  });
  const resources = buildSupportResourceSuggestions({
    category: 'racism_discrimination',
    facts,
    riskLevel: 'high',
    jurisdiction: 'NSW'
  });

  assert.ok(resources.some((item) => /Anti-Discrimination NSW|Human Rights/i.test(item.title)));
  assert.ok(resources.some((item) => /Fair Work/i.test(item.title)));
});

test('structured report preparation stays draft-like and not submitted', () => {
  const facts = {
    whatHappened: 'The user says their private photos were shared online.',
    evidenceMentioned: 'screenshots, links',
    missingInformation: ['date_details']
  };
  const structuredFacts = extractStructuredTriageFacts({
    text: 'Someone shared my private photos online.'
  });
  const report = buildStructuredReportPreparation({
    facts,
    structuredFacts,
    intakePlans: [
      {
        pathwayId: 'esafety_online_abuse',
        requiredFields: [],
        optionalFields: [],
        safetyWarnings: [],
        consentRequiredBeforeSharing: true,
        userFriendlyExplanation: 'Prepare for this pathway.'
      }
    ],
    triageCategory: 'online_abuse'
  });

  assert.equal(report.notSentYet, true);
  assert.equal(report.status, 'ready_to_review');
  assert.equal(report.consentState, 'not_granted');
});

test('arabic threat support reply stays in arabic', () => {
  const message = 'شخص يهددني بنشر رسائلي الخاصة';
  const facts = extractSupportFacts({ message });
  const reply = buildSupportReply({
    facts,
    responseMode: classifyResponseMode({
      message,
      sessionFacts: facts.originalFacts
    }),
    sessionContext: { language: detectAssistantLanguage(message) }
  });

  assert.equal(detectAssistantLanguage(message), 'ar');
  assert.match(reply.assistantMessage, /أنا|سلامتك|الخطوات/);
});

test('hindi scam reply stays in hindi', () => {
  const message = 'मेरे बैंक विवरण एक स्कैम में ले लिए गए';
  const facts = extractSupportFacts({ message });
  const reply = buildSupportReply({
    facts,
    responseMode: classifyResponseMode({
      message,
      sessionFacts: facts.originalFacts,
      selectedTopic: 'scamshield'
    }),
    sessionContext: { language: detectAssistantLanguage(message), selectedTopic: 'scamshield' }
  });

  assert.equal(detectAssistantLanguage(message), 'hi');
  assert.match(reply.assistantMessage, /मुझे|सुरक्षा|धोखाधड़ी/);
});

test('bengali scam reply stays in bengali', () => {
  const message = 'একজন স্ক্যামার আমার ব্যাংক তথ্য নিয়ে গেছে';
  const facts = extractSupportFacts({ message });
  const reply = buildSupportReply({
    facts,
    responseMode: classifyResponseMode({
      message,
      sessionFacts: facts.originalFacts,
      selectedTopic: 'scamshield'
    }),
    sessionContext: { language: detectAssistantLanguage(message), selectedTopic: 'scamshield' }
  });

  assert.equal(detectAssistantLanguage(message), 'bn');
  assert.match(reply.assistantMessage, /দুঃখিত|ব্যবহারিক|ব্যাংক/);
});

test('chinese privacy threat support reply uses chinese detection', () => {
  const message = '有人威胁公开我的私人信息';
  assert.equal(detectAssistantLanguage(message), 'zh-Hans');
});

test('spanish threat support reply uses spanish detection', () => {
  const message = 'Alguien me amenaza con publicar mis mensajes privados';
  assert.equal(detectAssistantLanguage(message), 'es');
});

test('arabic legal lookup answer localizes privacy act section 6', () => {
  const localized = localizeKnownLegalLookupAnswer({
    language: 'ar',
    message: 'ما هو القسم الذي يعرّف المعلومات الشخصية في Privacy Act 1988؟',
    assistantPayload: {
      assistantMessage: 'Under the Privacy Act 1988, personal information is defined in section 6.',
      citations: [
        {
          title: 'Privacy Act 1988',
          sectionRef: 'section 6',
          url: 'https://example.test/privacy'
        }
      ]
    }
  });

  assert.match(localized.assistantMessage, /section 6|القسم/);
});

test('hindi legal lookup answer localizes privacy act section 6', () => {
  const localized = localizeKnownLegalLookupAnswer({
    language: 'hi',
    message: 'Privacy Act 1988 में personal information किस section में defined है?',
    assistantPayload: {
      assistantMessage: 'Under the Privacy Act 1988, personal information is defined in section 6.',
      citations: [
        {
          title: 'Privacy Act 1988',
          sectionRef: 'section 6',
          url: 'https://example.test/privacy'
        }
      ]
    }
  });

  assert.match(localized.assistantMessage, /section 6|परिभाषा/);
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
