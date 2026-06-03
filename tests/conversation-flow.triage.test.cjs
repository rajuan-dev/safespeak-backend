const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConversationFlowCategoryLabel,
  buildConversationAssistantResponseMeta,
  buildMinimalConversationAppendResponse,
  buildConversationFlowPresentation,
  buildInternalPathways,
  buildIntakePlanner,
  buildStructuredReportPreparation,
  buildSuggestedMicroCardTitles,
  buildSupportResourceSuggestions,
  buildRelatedIssueTypes,
  buildSafetySteps,
  buildTurnHandlingPlan,
  resolveAssistantFormatPreferenceUpdate,
  buildAssistantMessageMetadata,
  classifyResponseMode,
  detectAssistantLanguage,
  detectEvidenceUploadIntent,
  detectTriageHandoffIntent,
  detectCategory,
  evaluateSafetyOverride,
  extractSupportFacts,
  extractStructuredTriageFacts,
  localizeKnownLegalLookupAnswer,
  shouldShowSources,
} = require('../src/modules/conversation-flow/conversation-flow.service.ts');
const {
  buildSupportReply,
} = require('../src/modules/conversation-flow/legacy-support-replies.ts');
const {
  composeEvidenceUploadResponse,
} = require('../src/modules/ai/legacy/response-composer.ts');
const {
  classifySafeSpeakIntent,
  classifySafeSpeakIntentDetails,
  detectMetaFeedbackOrCapabilityQuestion,
} = require('../src/modules/ai/intent-classifier.ts');
const {
  buildSafeSpeakFallbackResponse,
  generateSafeSpeakResponse,
  normalizeAssistantContent,
} = require('../src/modules/ai/model-response.service.ts');
const {
  validateSafeSpeakResponse,
} = require('../src/modules/ai/ai-guardrails.ts');
const {
  hasBrokenTextEncoding,
} = require('../src/modules/ai/text-encoding.ts');
const {
  sanitizeTimelineAssistantModelInput,
} = require('../src/modules/rag/rag.service.ts');
const {
  ASSISTANT_LANGUAGE_REGISTRY,
  resolveAssistantLanguage,
} = require('../src/modules/ai/assistant-language.ts');

const LEGACY_RUNTIME_REPLY_PATTERNS = [
  /Thank you for telling me about this/i,
  /You do not need to explain everything at once/i,
  /What feels most important for me to understand next/i,
  /A few practical steps that may help are/i,
  /Can you tell me a bit more about what happened/i,
  /Thank you\. What would feel helpful to share next/i,
  /I am sorry this happened to you\. You are safe to explore your options here/i,
  /I could not reliably retrieve the legal source just now/i
];

const createModelContext = ({
  latestUserMessage,
  intent,
  detectedLanguage = 'en',
  assistantFormatPreference = 'paragraphs',
  ragContext = []
}) => ({
  app: 'SafeSpeak',
  persona: 'SafeSpeak Guide',
  jurisdiction: 'AU',
  latestUserMessage,
  detectedLanguage,
  intent,
  intentPolicy: {
    intent,
    useRagByDefault: false,
    mutateTriage: false,
    guidance: []
  },
  ragStatus: ragContext.length > 0 ? 'retrieved' : 'not_required',
  assistantFormatPreference,
  conversationSummary: `user: ${latestUserMessage}`,
  activeIncidentSummary: 'None recorded.',
  consentSnapshot: {
    store_local: false,
    cloud_sync: false,
    share_with_agencies: false,
    retain_evidence: false,
    process_with_ai: true,
    translate_content: false,
    warm_referral: false
  },
  safetyContext: {
    latestTurnRiskLevel: 'low',
    activeIncidentRiskLevel: 'low',
    sessionHistoricalMaxRiskLevel: 'low',
    immediateDanger: false,
    threatsPresent: false,
    physicalHarm: false,
    domesticFamilyViolence: false,
    selfHarm: false,
    childSafety: false,
    recommendedEmergencyNumber: '000',
    relevantSupport: []
  },
  ragContext,
  constraints: []
});

const assertNoLegacyRuntimePhrases = (text) => {
  LEGACY_RUNTIME_REPLY_PATTERNS.forEach((pattern) => {
    assert.doesNotMatch(text, pattern);
  });
};

const countQuestions = (text) => (text.match(/\?/g) ?? []).length;
const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

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
      assistantMessage: 'Continue to Triage',
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

test('evidence upload intent is detected for screenshot upload questions', () => {
  const message = 'I have screenshots. Can I upload them?';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  assert.equal(detectEvidenceUploadIntent(message), true);
  assert.equal(responseMode, 'evidence_upload_intent');
});

test('meta feedback messages are not misclassified as incident support', () => {
  const message = 'it is wrong. you should be smart exactly like chatgpt.';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  assert.equal(detectMetaFeedbackOrCapabilityQuestion(message), true);
  assert.equal(classifySafeSpeakIntent(message), 'meta_feedback');
  assert.equal(responseMode, 'meta_feedback');
});

test('meta feedback fallback stays minimal and avoids old scripted copy', () => {
  const reply = buildSafeSpeakFallbackResponse({
    intent: 'meta_feedback',
    reason: 'guardrail_failure'
  });
  const metadata = buildAssistantMessageMetadata(reply);
  const combined = `${reply.assistantMessage} ${reply.nextQuestion}`.trim();

  assert.equal(
    reply.assistantMessage,
    "I'm sorry, I couldn't generate a reliable response just now. Please try again."
  );
  assert.doesNotMatch(combined, /too scripted|continue testing the chat behavior|Thank you for telling me about this|what happened/i);
  assert.equal(metadata.responseMode, 'guardrail_fallback');
  assert.equal(metadata.usedModelGeneration, false);
  assert.equal(metadata.guardrailStatus, 'fallback');
  assert.equal(metadata.staticTemplateUsed, false);
  assert.equal(metadata.responseSource, 'guardrail_fallback');
});

test('physical harm input is not classified as meta feedback or evidence upload', () => {
  const message = 'i was walking and someone hit me';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  const classification = classifySafeSpeakIntentDetails(message);

  assert.equal(classifySafeSpeakIntent(message), 'physical_harm');
  assert.equal(classification.intent, 'physical_harm');
  assert.equal(classification.classifierSource, 'rule');
  assert.notEqual(responseMode, 'meta_feedback');
  assert.notEqual(responseMode, 'evidence_upload_intent');
  assert.match(responseMode, /support_victim_style|emergency_safety/);
});

test('physical harm fallback never reuses the old meta feedback text', () => {
  const reply = buildSafeSpeakFallbackResponse({
    intent: 'physical_harm',
    reason: 'guardrail_failure'
  });
  const combined = `${reply.assistantMessage} ${reply.nextQuestion}`.trim();

  assert.equal(
    combined,
    "I'm sorry, I couldn't generate a reliable response just now. Please try again."
  );
  assert.doesNotMatch(combined, /too scripted|continue testing the chat behavior/i);
});

test('sequential meta feedback then physical harm classification stays distinct', () => {
  const firstMessage = 'it sounds scripted';
  const secondMessage = 'i was walking and someone hit me';
  const firstFacts = extractSupportFacts({ message: firstMessage });
  const secondFacts = extractSupportFacts({ message: secondMessage });

  assert.equal(classifySafeSpeakIntent(firstMessage), 'meta_feedback');
  assert.equal(
    classifyResponseMode({ message: firstMessage, sessionFacts: firstFacts.originalFacts }),
    'meta_feedback'
  );

  assert.equal(classifySafeSpeakIntent(secondMessage), 'physical_harm');
  assert.notEqual(
    classifyResponseMode({ message: secondMessage, sessionFacts: secondFacts.originalFacts }),
    'meta_feedback'
  );
});

test('meta feedback turn plan does not mutate the active incident triage', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'meta_feedback',
    responseMode: 'meta_feedback',
    existingFacts: {
      whatHappened: 'Someone sent death threats on Facebook.',
      evidenceMentioned: 'screenshots'
    },
    existingTimeline: {
      what: 'Someone sent death threats on Facebook.',
      evidence: 'screenshots'
    },
    sessionRiskLevel: 'high',
    latestTurnRiskLevel: 'none',
    sessionId: 'session-123',
    session: {
      activeIssueId: 'session-123:issue-1'
    },
    latestUserMessage: 'why are you replying the same thing every time?'
  });

  assert.equal(plan.nonIncidentTurn, true);
  assert.equal(plan.triageUpdated, false);
  assert.equal(plan.latestTurnRiskLevel, 'none');
  assert.equal(plan.activeIncidentRiskLevel, 'high');
  assert.equal(plan.sessionHistoricalMaxRiskLevel, 'high');
  assert.equal(plan.activeIssueId, 'session-123:issue-1');
});

test('greeting turn plan stays general and does not mutate triage', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'general_conversation',
    responseMode: 'clarification_needed',
    existingFacts: null,
    existingTimeline: {},
    sessionRiskLevel: 'low',
    latestTurnRiskLevel: 'none',
    sessionId: 'session-124',
    session: {},
    latestUserMessage: 'hi'
  });

  assert.equal(plan.nonIncidentTurn, true);
  assert.equal(plan.triageUpdated, false);
  assert.equal(plan.latestTurnRiskLevel, 'none');
  assert.equal(plan.activeIncidentRiskLevel, 'none');
});

test('language request turn plan does not mutate triage', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'language_or_translation',
    responseMode: 'clarification_needed',
    existingFacts: null,
    existingTimeline: {},
    sessionRiskLevel: 'low',
    latestTurnRiskLevel: 'none',
    sessionId: 'session-125',
    session: {},
    latestUserMessage: 'can you speak in bangla?'
  });

  assert.equal(plan.nonIncidentTurn, true);
  assert.equal(plan.triageUpdated, false);
  assert.equal(plan.latestTurnRiskLevel, 'none');
  assert.equal(plan.activeIncidentRiskLevel, 'none');
});

test('bullet question does not set bullet preference and is treated as a format question', () => {
  const resolution = resolveAssistantFormatPreferenceUpdate(
    'are you answering with bullet points every time?',
    'mix'
  );

  assert.equal(resolution.assistantFormatPreference, 'mix');
  assert.equal(resolution.formatPreferenceUpdated, false);
  assert.equal(resolution.subIntent, 'format_preference_question');
});

test('paragraph preference sets paragraphs explicitly', () => {
  const resolution = resolveAssistantFormatPreferenceUpdate(
    'please answer in paragraphs, not bullet points',
    'bullets'
  );

  assert.equal(resolution.assistantFormatPreference, 'paragraphs');
  assert.equal(resolution.formatPreferenceUpdated, true);
  assert.equal(resolution.subIntent, 'format_preference_set');
});

test('bullet preference sets bullets explicitly', () => {
  const resolution = resolveAssistantFormatPreferenceUpdate(
    'please use bullet points',
    'paragraphs'
  );

  assert.equal(resolution.assistantFormatPreference, 'bullets');
  assert.equal(resolution.formatPreferenceUpdated, true);
  assert.equal(resolution.subIntent, 'format_preference_set');
});

test('format preference question classifies as non-incident intent', () => {
  const classification = classifySafeSpeakIntentDetails(
    'are you answering with bullet points every time?'
  );

  assert.equal(classification.intent, 'format_preference_question');
  assert.equal(classification.classifierSource, 'rule');
});

test('format preference set turn plan does not mutate triage', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'format_preference_set',
    responseMode: 'clarification_needed',
    existingFacts: {
      whatHappened: 'Someone sent threats.',
    },
    existingTimeline: {
      what: 'Someone sent threats.'
    },
    sessionRiskLevel: 'high',
    latestTurnRiskLevel: 'low',
    sessionId: 'session-125b',
    session: {
      activeIssueId: 'session-125b:issue-1'
    },
    latestUserMessage: 'please answer in paragraphs'
  });

  assert.equal(plan.nonIncidentTurn, true);
  assert.equal(plan.triageUpdated, false);
  assert.equal(plan.activeIssueId, 'session-125b:issue-1');
});

test('general legal education classifies separately from specific legal advice', () => {
  assert.equal(
    classifySafeSpeakIntent('Can you briefly explain criminal law in Australia?'),
    'legal_general_information'
  );
  assert.equal(
    classifySafeSpeakIntent('about criminal law'),
    'legal_general_information'
  );
  assert.equal(
    classifySafeSpeakIntent('Is this illegal? Can I sue them?'),
    'legal_boundary_specific_case'
  );
});

test('general legal information turn plan does not mutate triage', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'legal_general_information',
    responseMode: 'clarification_needed',
    existingFacts: {
      whatHappened: 'Someone sent threats.'
    },
    existingTimeline: {
      what: 'Someone sent threats.'
    },
    sessionRiskLevel: 'high',
    latestTurnRiskLevel: 'low',
    sessionId: 'session-125c',
    session: {
      activeIssueId: 'session-125c:issue-1'
    },
    latestUserMessage: 'Can you briefly explain criminal law in Australia?'
  });

  assert.equal(plan.nonIncidentTurn, true);
  assert.equal(plan.triageUpdated, false);
  assert.equal(plan.latestTurnRiskLevel, 'none');
  assert.equal(plan.activeIssueId, 'session-125c:issue-1');
});

test('minimal debug response keeps only the important conversation fields', () => {
  const minimal = buildMinimalConversationAppendResponse({
    session: {
      id: 'session-1',
      selectedTopic: 'general_assistant',
      detectedLanguage: 'en',
      status: 'active',
      safetyRiskLevel: 'low',
      latestTurnRiskLevel: 'none',
      activeIncidentRiskLevel: 'none',
      sessionHistoricalMaxRiskLevel: 'low',
      assistantFormatPreference: 'paragraphs',
      messageCount: 2,
      userTurnCount: 1,
      createdAt: 'omit-me'
    },
    userMessage: {
      id: 'user-1',
      role: 'user',
      content: 'hi',
      turnNumber: 1,
      metadata: {
        omit: true
      }
    },
    assistantMessage: {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hello.',
      turnNumber: 2,
      metadata: {
        intent: 'general_conversation',
        responseMode: 'safespeak_model',
        intentConfidence: 'high',
        usedModelGeneration: true,
        staticTemplateUsed: false,
        responseSource: 'openai_model',
        selectedResponseSource: 'openai_model',
        model: 'gpt-5.2',
        guardrailStatus: 'passed',
        fallbackReason: undefined,
        ragStatus: 'not_required',
        nonIncidentTurn: true,
        triageUpdated: false,
        latestTurnRiskLevel: 'none',
        activeIncidentRiskLevel: 'none',
        sessionHistoricalMaxRiskLevel: 'low',
        assistantFormatPreference: 'paragraphs',
        formatPreferenceUpdated: false,
        encodingWarning: false,
        classifierSource: 'rule',
        matchedSignals: ['greeting'],
        consentSnapshot: {
          omit: true
        }
      }
    },
    triage: {
      likelyCategory: 'general_support',
      confidenceScore: 0.1,
      safetyRiskLevel: 'low',
      relatedIssueTypes: ['general_support'],
      structuredFacts: {
        physicalViolence: false,
        threatsPresent: false,
        immediateDanger: false,
        evidenceAvailable: false,
        scamFraud: false,
        workplaceBullying: false,
        racismDiscrimination: false,
        migrationOrVisaThreat: false,
        languageOrInterpreterNeed: false,
        omit: true
      },
      presentation: {
        omit: true
      }
    },
    responseMeta: {
      intent: 'general_conversation',
      reviewStatus: 'general_conversation',
      responseSource: 'openai_model',
      selectedResponseSource: 'openai_model',
      model: 'gpt-5.2',
      ragStatus: 'not_required',
      guardrailStatus: 'passed',
      nonIncidentTurn: true,
      triageUpdated: false,
      assistantLanguage: 'en',
      showSources: false,
      sourceDisplayReason: 'hidden_support_reply',
      citations: []
    }
  });

  assert.equal(minimal.assistantMessage.content, 'Hello.');
  assert.equal(minimal.assistantMessage.metadata.intent, 'general_conversation');
  assert.equal(minimal.responseMeta.responseSource, 'openai_model');
  assert.equal(minimal.triageSummary.exists, true);
  assert.equal('factExtraction' in minimal, false);
  assert.equal('presentation' in minimal.triageSummary, false);
  assert.equal('consentSnapshot' in minimal.assistantMessage.metadata, false);
});

test('structured bullets are allowed when the user asks for scam warning signs', () => {
  const validation = validateSafeSpeakResponse({
    text: ['- Urgent payment demand', '- Suspicious link', '- Pressure to act immediately'].join('\n'),
    intent: 'scam_check',
    jurisdiction: 'AU',
    latestUserMessage: 'Give me bullet points about scam warning signs',
    preferParagraphs: true
  });

  assert.equal(validation.violations.includes('bullet_heavy_non_actionable'), false);
});

test('evidence upload without an active incident stays non-incident and does not create new triage facts', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'evidence_upload',
    responseMode: 'evidence_upload_intent',
    existingFacts: null,
    existingTimeline: {},
    sessionRiskLevel: 'low',
    latestTurnRiskLevel: 'low',
    sessionId: 'session-126',
    session: {},
    latestUserMessage: 'I have photos of what happened.'
  });

  assert.equal(plan.nonIncidentTurn, true);
  assert.equal(plan.triageUpdated, false);
  assert.equal(plan.evidenceOnlyUpdate, false);
  assert.deepEqual(plan.nextTimeline, {});
});

test('active incident evidence follow-up stays on the same issue and adds evidence only', () => {
  const plan = buildTurnHandlingPlan({
    selectedIntent: 'evidence_upload',
    responseMode: 'evidence_upload_intent',
    existingFacts: {
      whatHappened: 'Someone sent me death threats on Facebook.'
    },
    existingTimeline: {
      what: 'Someone sent me death threats on Facebook.'
    },
    sessionRiskLevel: 'high',
    latestTurnRiskLevel: 'low',
    sessionId: 'session-127',
    session: {
      activeIssueId: 'session-127:issue-1'
    },
    latestUserMessage: 'I have screenshots.'
  });

  assert.equal(plan.nonIncidentTurn, false);
  assert.equal(plan.triageUpdated, true);
  assert.equal(plan.evidenceOnlyUpdate, true);
  assert.equal(plan.activeIssueId, 'session-127:issue-1');
  assert.equal(plan.latestTurnRiskLevel, 'low');
  assert.equal(plan.activeIncidentRiskLevel, 'high');
  assert.match(plan.nextTimeline.evidence, /screenshots/i);
});

test('model response path uses generation metadata for general conversation', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: 'Hi. I can help with a question or with something specific that happened.'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'general_conversation',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'hi',
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage: 'hi',
        detectedLanguage: 'en',
        intent: 'general_conversation',
        conversationSummary: 'user: hi',
        activeIncidentSummary: 'None recorded.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'none',
          activeIncidentRiskLevel: 'none',
          sessionHistoricalMaxRiskLevel: 'none',
          immediateDanger: false,
          threatsPresent: false,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });

    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.staticTemplateUsed, false);
    assert.equal(reply.responseMode, 'safespeak_model');
    assert.equal(reply.responseSource, 'openai_model');
    assert.ok(countWords(reply.assistantMessage) <= 20);
    assert.doesNotMatch(reply.assistantMessage, /sorry this happened|safe to explore your options/i);
    assert.doesNotMatch(
      reply.assistantMessage,
      /Thank you for telling me|You do not need to explain everything at once/i
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('empty model output falls back to a technical retry message', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text: '   '
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'general_conversation',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'hi',
      context: createModelContext({
        latestUserMessage: 'hi',
        intent: 'general_conversation'
      })
    });

    assert.equal(callCount, 2);
    assert.equal(reply.usedModelGeneration, false);
    assert.equal(reply.staticTemplateUsed, false);
    assert.equal(reply.responseSource, 'model_empty_fallback');
    assert.equal(reply.responseMode, 'model_empty_fallback');
    assert.equal(
      reply.assistantMessage,
      "I'm sorry, I couldn't generate a reliable response just now. Please try again."
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('guardrail rewrites wrong emergency number for AU emergency context', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'Call 911 right now. Are you alone? Are the doors locked?'
            : 'If you are in immediate danger in Australia, call 000 now.'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'safety_crisis',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'someone is outside my house threatening me right now',
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage: 'someone is outside my house threatening me right now',
        detectedLanguage: 'en',
        intent: 'safety_crisis',
        conversationSummary: 'user reports immediate threat',
        activeIncidentSummary: 'Threat outside home right now.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'urgent',
          activeIncidentRiskLevel: 'urgent',
          sessionHistoricalMaxRiskLevel: 'urgent',
          immediateDanger: true,
          threatsPresent: true,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });

    assert.equal(reply.guardrailStatus, 'regenerated');
    assert.match(reply.assistantMessage, /000/);
    assert.doesNotMatch(reply.assistantMessage, /\b911|999|112\b/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('utf8 repair preserves assistant punctuation through model output and json round-trip', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: 'IΓÇÖm using a ΓÇ£safe defaultΓÇ¥ style ΓÇö IΓÇÖll keep it natural.'
    })
  });

  try {
    assert.equal(
      normalizeAssistantContent('IΓÇÖm using a ΓÇ£safe defaultΓÇ¥ style ΓÇö IΓÇÖll keep it natural.'),
      'I’m using a “safe default” style — I’ll keep it natural.'
    );

    const reply = await generateSafeSpeakResponse({
      intent: 'meta_feedback',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'you sound scripted',
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage: 'you sound scripted',
        detectedLanguage: 'en',
        intent: 'meta_feedback',
        conversationSummary: 'user says the reply sounds scripted',
        activeIncidentSummary: 'None recorded.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'none',
          activeIncidentRiskLevel: 'none',
          sessionHistoricalMaxRiskLevel: 'none',
          immediateDanger: false,
          threatsPresent: false,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });
    const apiJson = JSON.parse(JSON.stringify({ assistantMessage: reply.assistantMessage }));

    assert.equal(reply.assistantMessage, 'I’m using a “safe default” style — I’ll keep it natural.');
    assert.equal(apiJson.assistantMessage, 'I’m using a “safe default” style — I’ll keep it natural.');
    assert.doesNotMatch(reply.assistantMessage, /ΓÇ|â€™|â€œ|â€\x9D|â€“|â€”/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('evidence response guardrail regenerates legal-strategy phrasing into lower-pressure guidance', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'You can keep the photos because they are hard to dispute and strong evidence for a complaint. Would you like help organising them?'
            : 'You can keep the photos as part of your record if that feels comfortable. Try to keep the originals unchanged and note what each photo shows. Would you like help organising them into a simple timeline?'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'evidence_upload',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'I have photos of what happened.',
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage: 'I have photos of what happened.',
        detectedLanguage: 'en',
        intent: 'evidence_upload',
        conversationSummary: 'user says they have photos',
        activeIncidentSummary: 'None recorded.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'low',
          activeIncidentRiskLevel: 'none',
          sessionHistoricalMaxRiskLevel: 'none',
          immediateDanger: false,
          threatsPresent: false,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });

    assert.equal(callCount, 2);
    assert.equal(reply.guardrailStatus, 'regenerated');
    assert.doesNotMatch(reply.assistantMessage, /hard to dispute|strong evidence|prove your case|build your case|complaint/i);
    assert.match(reply.assistantMessage, /part of your record|originals unchanged|photo shows/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('mojibake input guard detects broken bengali transport patterns', () => {
  assert.equal(hasBrokenTextEncoding('αªåαª«αª╛ broken text'), true);
  assert.equal(hasBrokenTextEncoding('à¦à¦®à¦¾à¦° à¦¬à¦¸'), true);
  assert.equal(
    hasBrokenTextEncoding('আমার বস আমার উচ্চারণ নিয়ে হাসাহাসি করে'),
    false
  );
});

test('timeline assistant sanitizer excludes corrupted history and timeline values', () => {
  const sanitized = sanitizeTimelineAssistantModelInput({
    message: 'I have screenshots from Facebook.',
    conversation: [
      { role: 'user', content: 'Someone threatened me on Facebook.' },
      { role: 'assistant', content: 'αªåαª«αª╛' }
    ],
    timeline: {
      what: 'Someone threatened me',
      evidence: 'à¦à¦®à¦¾à¦°'
    },
    language: 'en',
    topK: 4
  });

  assert.equal(sanitized.encodingWarning, true);
  assert.equal(sanitized.excludedConversationCount, 1);
  assert.deepEqual(sanitized.excludedTimelineKeys, ['evidence']);
  assert.equal(sanitized.sanitizedInput.conversation.length, 1);
  assert.equal(sanitized.sanitizedInput.timeline.what, 'Someone threatened me');
  assert.equal('evidence' in sanitized.sanitizedInput.timeline, false);
});

test('bengali response normalization preserves unicode and avoids mojibake', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'আমি দুঃখিত যে এটা হয়েছে। আপনি যদি এখন নিরাপদে থাকেন, চাইলে আমরা ধীরে ধীরে কী ঘটেছে তা গুছিয়ে নিতে পারি।'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'incident_disclosure',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage:
        'আমার বস আমার উচ্চারণ নিয়ে হাসাহাসি করে এবং বলে আমি এখানে মানাই না।',
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage:
          'আমার বস আমার উচ্চারণ নিয়ে হাসাহাসি করে এবং বলে আমি এখানে মানাই না।',
        detectedLanguage: 'bn',
        intent: 'incident_disclosure',
        assistantFormatPreference: 'paragraphs',
        conversationSummary: 'user reports workplace humiliation in Bengali',
        activeIncidentSummary: 'None recorded.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'low',
          activeIncidentRiskLevel: 'low',
          sessionHistoricalMaxRiskLevel: 'low',
          immediateDanger: false,
          threatsPresent: false,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });

    assert.match(reply.assistantMessage, /আমি দুঃখিত|নিরাপদে থাকেন/u);
    assert.doesNotMatch(reply.assistantMessage, /αª|ΓÇ|à¦|à§/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test('meta feedback replies regenerate away from bullet-heavy formatting', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? '- I hear you.\n- I can answer more directly.\n- Ask again.'
            : 'That reply was too list-heavy. Ask again and I will answer more naturally.'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'meta_feedback',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'why are you replying the same thing every time?',
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage: 'why are you replying the same thing every time?',
        detectedLanguage: 'en',
        intent: 'meta_feedback',
        assistantFormatPreference: 'paragraphs',
        conversationSummary: 'user says replies feel repetitive',
        activeIncidentSummary: 'None recorded.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'none',
          activeIncidentRiskLevel: 'none',
          sessionHistoricalMaxRiskLevel: 'none',
          immediateDanger: false,
          threatsPresent: false,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });

    assert.equal(callCount, 2);
    assert.equal(reply.guardrailStatus, 'regenerated');
    assert.doesNotMatch(reply.assistantMessage, /^\s*[-*•]/m);
    assert.match(reply.assistantMessage, /more naturally|too list-heavy/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('meta feedback stays model-generated and avoids technical fallback when regeneration succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'You are right to call that out. I can keep replies more natural and less repetitive from here.'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'meta_feedback',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'why are you replying the same thing every time?',
      context: createModelContext({
        latestUserMessage: 'why are you replying the same thing every time?',
        intent: 'meta_feedback'
      })
    });

    assert.equal(reply.intent, 'meta_feedback');
    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.staticTemplateUsed, false);
    assert.notEqual(reply.responseMode, 'model_empty_fallback');
    assert.notEqual(reply.responseMode, 'guardrail_fallback');
    assert.ok(countWords(reply.assistantMessage) <= 25);
  } finally {
    global.fetch = originalFetch;
  }
});

test('meta feedback does not technical fallback when the reply is long but repairable', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'You are hearing repetition because I have been leaning too hard on the same phrasing, and that makes the chat feel static instead of responsive. I can answer your actual point more directly, keep the wording shorter, and stop recycling the same structure in every turn so it feels more natural. If you want, ask the same question again and I will answer it in a simpler way.'
            : 'You are right. I have been too repetitive. Ask again and I will answer more directly.'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'meta_feedback',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'why are you replying the same thing every time?',
      context: createModelContext({
        latestUserMessage: 'why are you replying the same thing every time?',
        intent: 'meta_feedback'
      })
    });

    assert.equal(callCount, 2);
    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.guardrailStatus, 'regenerated');
    assert.equal(reply.fallbackReason, 'too_long_for_intent');
    assert.equal(reply.responseSource, 'openai_model_regenerated');
    assert.notEqual(reply.responseMode, 'guardrail_fallback');
    assert.notEqual(reply.responseSource, 'guardrail_fallback');
  } finally {
    global.fetch = originalFetch;
  }
});

test('legal boundary specific-case response stays information-only and uses rag metadata when retrieved', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'SafeSpeak cannot decide whether it is illegal. This is information only, not legal advice. Possible options may include checking the reporting pathway that fits your situation in NSW.'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'legal_boundary_specific_case',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'Is this illegal? Can I sue them?',
      ragStatus: 'retrieved',
      ragContext: [
        {
          sourceTitle: 'Anti-Discrimination NSW guidance',
          jurisdiction: 'NSW',
          sourceType: 'Webpage',
          url: 'https://example.test/nsw-guidance',
          lastUpdated: '2026-01-01',
          relevantSnippet: 'This source explains complaint pathways and information-only guidance.'
        }
      ],
      context: {
        app: 'SafeSpeak',
        jurisdiction: 'AU',
        latestUserMessage: 'Is this illegal? Can I sue them?',
        detectedLanguage: 'en',
        intent: 'legal_boundary_specific_case',
        conversationSummary: 'user asks about legal boundary',
        activeIncidentSummary: 'None recorded.',
        consentSnapshot: {
          store_local: false,
          cloud_sync: false,
          share_with_agencies: false,
          retain_evidence: false,
          process_with_ai: true,
          translate_content: false,
          warm_referral: false
        },
        safetyContext: {
          latestTurnRiskLevel: 'low',
          activeIncidentRiskLevel: 'low',
          sessionHistoricalMaxRiskLevel: 'low',
          immediateDanger: false,
          threatsPresent: false,
          physicalHarm: false,
          domesticFamilyViolence: false,
          selfHarm: false,
          childSafety: false,
          recommendedEmergencyNumber: '000',
          relevantSupport: []
        },
        ragContext: [],
        constraints: []
      }
    });

    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.ragStatus, 'retrieved');
    assert.equal(reply.responseSource, 'openai_model_with_rag');
    assert.match(reply.disclaimer, /information only, not legal advice/i);
    assert.doesNotMatch(reply.assistantMessage, /you should sue|you have a case|this is illegal|you can sue|suing is an option|criminal matter/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('general legal information gives a useful brief overview without over-refusing', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'Criminal law generally deals with offences that the state can investigate and prosecute. In Australia, many offences are handled under state and territory laws, while some matters involve Commonwealth law. This is general information only, not legal advice.'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'legal_general_information',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'Can you briefly explain criminal law in Australia?',
      context: createModelContext({
        latestUserMessage: 'Can you briefly explain criminal law in Australia?',
        intent: 'legal_general_information'
      })
    });

    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.staticTemplateUsed, false);
    assert.equal(reply.responseSource, 'openai_model');
    assert.match(reply.assistantMessage, /criminal law generally deals with|state and territory laws/i);
    assert.match(reply.assistantMessage, /information only|not legal advice/i);
    assert.doesNotMatch(reply.assistantMessage, /you can sue|you have a case|this is illegal/i);
    assert.equal(reply.showSources, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('general legal follow-up topic stays educational and does not over-refuse', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'Criminal law generally deals with conduct the law treats as offences. Police may investigate suspected offences, and courts handle charges and outcomes. This is general information only, not legal advice.'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'legal_general_information',
      intentConfidence: 'medium',
      classifierSource: 'rule',
      latestUserMessage: 'about criminal law',
      context: createModelContext({
        latestUserMessage: 'about criminal law',
        intent: 'legal_general_information'
      })
    });

    assert.equal(reply.usedModelGeneration, true);
    assert.match(reply.assistantMessage, /criminal law generally deals with|police may investigate/i);
    assert.doesNotMatch(reply.assistantMessage, /i can.t help with that|i cannot answer/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('physical harm replies stay short and ask one question max', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'I’m sorry that happened. If you feel safe to answer, are you hurt or in any immediate danger right now?'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'physical_harm',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'i was walking and someone hit me',
      context: createModelContext({
        latestUserMessage: 'i was walking and someone hit me',
        intent: 'physical_harm'
      })
    });

    assert.equal(reply.usedModelGeneration, true);
    assert.ok(countWords(reply.assistantMessage) <= 30);
    assert.ok(countQuestions(reply.assistantMessage) <= 1);
    assert.doesNotMatch(reply.assistantMessage, /\b911|999|112\b/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('physical harm long reply regenerates instead of using technical fallback', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'I’m sorry that happened. What you described sounds serious, and it can help to pause, check your surroundings, think about whether you are hurt, notice whether the person is still nearby, and consider whether you want to document the location, the time, and any witnesses before deciding what to do next. If you are injured you may want medical help, and if the person is still there you may want urgent support. Are you hurt right now?'
            : 'I’m sorry that happened. Are you hurt or in any immediate danger right now?'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'physical_harm',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'i was walking and someone hit me',
      context: createModelContext({
        latestUserMessage: 'i was walking and someone hit me',
        intent: 'physical_harm'
      })
    });

    assert.equal(callCount, 2);
    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.responseSource, 'openai_model_regenerated');
    assert.notEqual(reply.responseSource, 'guardrail_fallback');
    assert.doesNotMatch(reply.assistantMessage, /\b911|999|112\b/);
    assert.ok(countQuestions(reply.assistantMessage) <= 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('evidence replies stay short and avoid false upload or legal-strategy claims', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text:
        'You can keep the photos unchanged as part of your record. Nothing is automatically shared here. Would you like help noting what each photo shows?'
    })
  });

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'evidence_upload',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'I have photos of what happened.',
      context: createModelContext({
        latestUserMessage: 'I have photos of what happened.',
        intent: 'evidence_upload'
      })
    });

    assert.equal(reply.usedModelGeneration, true);
    assert.ok(countWords(reply.assistantMessage) <= 30);
    assert.ok(countQuestions(reply.assistantMessage) <= 1);
    assert.doesNotMatch(reply.assistantMessage, /hard to dispute|prove your case|strong evidence|build your case/i);
    assert.doesNotMatch(reply.assistantMessage, /uploaded for you|saved for you|shared for you|sent for you|synced for you/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('evidence upload long reply regenerates and stays consent-aware', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'Photos can be useful for your own record, and it may help to keep the original files, note when each image was taken, and think about whether location data, cloud sync, retention, or future sharing settings match what you want before doing anything else here. Nothing should be assumed about sharing unless you choose it, and uploading is separate from any later AI step or agency step. Would you like help writing a short note for each photo so the context stays clear?'
            : 'You can keep the photos as part of your record. Nothing is automatically shared here. Would you like help noting what each photo shows?'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'evidence_upload',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'I have photos of what happened.',
      context: createModelContext({
        latestUserMessage: 'I have photos of what happened.',
        intent: 'evidence_upload'
      })
    });

    assert.equal(callCount, 2);
    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.responseSource, 'openai_model_regenerated');
    assert.notEqual(reply.responseSource, 'guardrail_fallback');
    assert.match(reply.assistantMessage, /nothing is automatically shared/i);
    assert.doesNotMatch(reply.assistantMessage, /uploaded for you|saved for you|shared for you|sent for you|synced for you/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('too-long model output uses compact retry prompt and returns regenerated model output', async () => {
  const originalFetch = global.fetch;
  const requestBodies = [];
  let callCount = 0;
  global.fetch = async (_url, options) => {
    callCount += 1;
    requestBodies.push(JSON.parse(options.body));

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'You can keep the photos unchanged as part of your own record, and it may help to note what each image shows, where it was taken, whether metadata matters to you, and whether any storage or sharing settings fit what you want before you do anything else. Uploading is separate from any later AI processing step, and nothing should be assumed about sharing or retention unless you choose that. If you want, I can help you organise the photos into a short timeline and explain the difference between local storage, cloud sync, retention, and sharing choices.'
            : 'You can keep the photos as part of your record. Nothing is automatically shared here. Would you like help noting what each photo shows?'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'evidence_upload',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'I have photos of what happened.',
      context: createModelContext({
        latestUserMessage: 'I have photos of what happened.',
        intent: 'evidence_upload'
      })
    });

    assert.equal(callCount, 2);
    assert.match(
      requestBodies[1].input[1].content,
      /Rewrite more briefly in SafeSpeak persona\. Keep the meaning\. Use short paragraphs\. Ask at most one question\. Do not add new claims\. Keep it information-only and low-pressure\./
    );
    assert.equal(reply.usedModelGeneration, true);
    assert.equal(reply.guardrailStatus, 'regenerated');
    assert.equal(reply.fallbackReason, 'too_long_for_intent');
    assert.equal(reply.responseSource, 'openai_model_regenerated');
    assert.equal(reply.staticTemplateUsed, false);
    assert.notEqual(reply.responseMode, 'guardrail_fallback');
  } finally {
    global.fetch = originalFetch;
  }
});

test('legal boundary specific-case outputs regenerate away from direct legal conclusions', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;

    return {
      ok: true,
      json: async () => ({
        output_text:
          callCount === 1
            ? 'Whether it’s illegal depends, but you can sue and this sounds like a criminal matter.'
            : 'SafeSpeak can’t decide whether it was illegal. This is information only, not legal advice. If you want, what state or territory did this happen in?'
      })
    };
  };

  try {
    const reply = await generateSafeSpeakResponse({
      intent: 'legal_boundary_specific_case',
      intentConfidence: 'high',
      classifierSource: 'rule',
      latestUserMessage: 'Is this illegal? Can I sue them?',
      context: createModelContext({
        latestUserMessage: 'Is this illegal? Can I sue them?',
        intent: 'legal_boundary_specific_case'
      })
    });

    assert.equal(callCount, 2);
    assert.equal(reply.guardrailStatus, 'regenerated');
    assert.match(reply.assistantMessage, /information only|not legal advice/i);
    assert.ok(countQuestions(reply.assistantMessage) <= 1);
    assert.doesNotMatch(reply.assistantMessage, /you can sue|suing is an option|criminal matter|this is illegal/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('model-path replies do not reuse removed static assistant phrases', async () => {
  const originalFetch = global.fetch;
  const outputs = [
    'I’m sorry that happened. Are you hurt or in any immediate danger right now?',
    'You can keep the photos unchanged if you want them as part of your record. Would you like help organising them?',
    'You are right to question the format. I can answer more naturally and keep future replies in short paragraphs.',
    'SafeSpeak can’t decide whether it was illegal. This is information only, not legal advice. If you want, what state or territory did this happen in?'
  ];
  let callIndex = 0;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: outputs[Math.min(callIndex++, outputs.length - 1)]
    })
  });

  const cases = [
    {
      latestUserMessage: 'i was walking and someone hit me',
      intent: 'physical_harm'
    },
    {
      latestUserMessage: 'I have photos of what happened',
      intent: 'evidence_upload'
    },
    {
      latestUserMessage: 'why are you replying the same thing every time?',
      intent: 'meta_feedback'
    },
    {
      latestUserMessage: 'Is this illegal? Can I sue them?',
      intent: 'legal_boundary_specific_case',
      ragStatus: 'retrieved',
      ragContext: [
        {
          sourceTitle: 'Anti-Discrimination NSW guidance',
          jurisdiction: 'NSW',
          sourceType: 'Webpage',
          url: 'https://example.test/nsw-guidance',
          lastUpdated: '2026-01-01',
          relevantSnippet: 'This source explains complaint pathways and information-only guidance.'
        }
      ]
    }
  ];

  try {
    for (const testCase of cases) {
      const reply = await generateSafeSpeakResponse({
        intent: testCase.intent,
        intentConfidence: 'high',
        classifierSource: 'rule',
        latestUserMessage: testCase.latestUserMessage,
        ragStatus: testCase.ragStatus,
        ragContext: testCase.ragContext,
        context: createModelContext({
          latestUserMessage: testCase.latestUserMessage,
          intent: testCase.intent,
          ragContext: testCase.ragContext ?? []
        })
      });

      assert.equal(reply.usedModelGeneration, true);
      assert.equal(reply.staticTemplateUsed, false);
      assert.ok(
        reply.responseSource === 'openai_model' || reply.responseSource === 'openai_model_with_rag'
      );
      assertNoLegacyRuntimePhrases(reply.assistantMessage);
      if (testCase.intent === 'physical_harm' || testCase.intent === 'evidence_upload') {
        assert.ok(countQuestions(reply.assistantMessage) <= 1);
        assert.ok(countWords(reply.assistantMessage) <= 30);
      }
      if (testCase.intent === 'legal_boundary_specific_case') {
        assert.match(reply.assistantMessage, /information only|not legal advice/i);
        assert.doesNotMatch(reply.assistantMessage, /you can sue|suing is an option|criminal matter|this is illegal/i);
      }
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('evidence upload consent reply is direct, privacy-first, and metadata-ready', () => {
  const reply = composeEvidenceUploadResponse({
    userMessage: 'I have screenshots. Can I upload them?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const combined = `${reply.assistantMessage} ${reply.nextQuestion}`.trim();
  const metadata = buildAssistantMessageMetadata(reply);

  assert.match(reply.assistantMessage, /^(Yes|You can)/);
  assert.match(combined, /won.t be sent to any agency automatically|nothing should be shared automatically|does not submit a report/i);
  assert.match(combined, /cloud sync is off/i);
  assert.match(combined, /local/i);
  assert.match(combined, /retention is off|should not keep/i);
  assert.equal((combined.match(/\?/g) ?? []).length, 1);
  assert.doesNotMatch(combined, /what happened/i);
  assert.equal(metadata.intent, 'evidence_upload_intent');
  assert.equal(metadata.responseMode, 'evidence_consent');
  assert.equal(metadata.intentConfidence, 'high');
  assert.equal(metadata.responseVariant, 'local_only');
  assert.deepEqual(metadata.consentSnapshot, {
    store_local: true,
    cloud_sync: false,
    share_with_agencies: false,
    retain_evidence: false,
    process_with_ai: false
  });
});

test('repeated evidence upload follow-up changes wording and stays concise', () => {
  const firstReply = composeEvidenceUploadResponse({
    userMessage: 'I have screenshots. Can I upload them?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const secondReply = composeEvidenceUploadResponse({
    userMessage: 'Can I attach screenshots?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 1,
      latestAssistantMessage: firstReply.assistantMessage,
    }
  });

  assert.notEqual(secondReply.assistantMessage, firstReply.assistantMessage);
  assert.equal(secondReply.responseVariant, 'repeat_follow_up');
  assert.match(`${secondReply.assistantMessage} ${secondReply.nextQuestion}`, /shared automatically|agency/i);
  assert.equal((`${secondReply.assistantMessage} ${secondReply.nextQuestion}`.match(/\?/g) ?? []).length, 1);
});

test('danger messages still stay in emergency mode even when upload is mentioned', () => {
  const message = 'I have screenshots, and my partner says he will kill me tonight. Can I upload them?';
  const facts = extractSupportFacts({ message });
  const responseMode = classifyResponseMode({
    message,
    sessionFacts: facts.originalFacts
  });

  assert.equal(detectEvidenceUploadIntent(message), true);
  assert.equal(responseMode, 'emergency_safety');
});

test('high-risk evidence upload response answers upload first and includes a short 000 reminder', () => {
  const reply = composeEvidenceUploadResponse({
    userMessage: 'I have screenshots. Can I upload them?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    activeIncident: {
      matchedFacts: ['death threats'],
      platforms: ['Facebook'],
      threatPresent: true,
      immediateDanger: true,
    },
    latestTurnRiskLevel: 'urgent',
    activeIncidentRiskLevel: 'high',
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const combined = `${reply.assistantMessage} ${reply.nextQuestion}`;

  assert.match(reply.assistantMessage, /^(Yes|You can)/);
  assert.match(combined, /agency|shared automatically|sent to any agency/i);
  assert.match(combined, /call 000/i);
  assert.equal(reply.responseVariant, 'high_risk_context');
  assert.equal((combined.match(/\?/g) ?? []).length, 1);
});

test('cloud sync on response mentions syncing and avoids local-only wording', () => {
  const reply = composeEvidenceUploadResponse({
    userMessage: 'Can I upload evidence?',
    consent: {
      store_local: true,
      cloud_sync: true,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const combined = `${reply.assistantMessage} ${reply.nextQuestion}`;

  assert.equal(reply.responseVariant, 'cloud_sync_on');
  assert.match(combined, /cloud sync is on|may sync/i);
  assert.doesNotMatch(combined, /local only for now/i);
});

test('agency sharing on response still requires confirmation before sending anywhere', () => {
  const reply = composeEvidenceUploadResponse({
    userMessage: 'I have proof. Can I upload it?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: true,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });

  assert.equal(reply.responseVariant, 'agency_sharing_on');
  assert.match(reply.assistantMessage, /still ask before sending|without a clear confirmation/i);
});

test('ai analysis question explains ai consent only when asked', () => {
  const normalReply = composeEvidenceUploadResponse({
    userMessage: 'I have screenshots. Can I upload them?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: true,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const aiReply = composeEvidenceUploadResponse({
    userMessage: 'Will AI analyse my screenshot if I upload it?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: true,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const aiMetadata = buildAssistantMessageMetadata(aiReply);

  assert.doesNotMatch(normalReply.assistantMessage, /AI processing is enabled|analyse/i);
  assert.match(aiReply.assistantMessage, /Only if you choose|should only analyse|does not automatically trigger AI analysis/i);
  assert.match(aiReply.assistantMessage, /AI processing is enabled/i);
  assert.match(aiReply.nextQuestion, /without AI analysis|decide about AI analysis later/i);
  assert.doesNotMatch(aiReply.assistantMessage, /has been analys|was analysed/i);
  assert.equal(aiReply.responseVariant, 'ai_analysis_question');
  assert.equal(aiMetadata.subIntent, 'ai_analysis_question');
  assert.equal(aiMetadata.consentSnapshot.process_with_ai, true);
});

test('ai analysis question with process_with_ai off keeps evidence separate from ai', () => {
  const aiReply = composeEvidenceUploadResponse({
    userMessage: 'Will AI analyze my screenshot if I upload it?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: false,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });
  const combined = `${aiReply.assistantMessage} ${aiReply.nextQuestion}`;
  const aiMetadata = buildAssistantMessageMetadata(aiReply);

  assert.match(combined, /AI processing is off|do not allow AI processing|should not analyse/i);
  assert.match(combined, /does not automatically trigger AI analysis|not automatically make SafeSpeak analyse/i);
  assert.match(aiReply.nextQuestion, /evidence only/i);
  assert.equal(aiMetadata.subIntent, 'ai_analysis_question');
  assert.equal(aiMetadata.consentSnapshot.process_with_ai, false);
});

test('high-risk ai analysis question keeps ai choice question and adds short 000 reminder', () => {
  const aiReply = composeEvidenceUploadResponse({
    userMessage: 'If I upload it, will AI read my screenshot?',
    consent: {
      store_local: true,
      cloud_sync: false,
      share_with_agencies: false,
      use_anonymised_analytics: false,
      process_with_ai: true,
      transcribe_audio: false,
      translate_content: false,
      retain_evidence: false,
      warm_referral: false
    },
    activeIncident: {
      matchedFacts: ['death threats'],
      platforms: ['Facebook'],
      threatPresent: true,
      immediateDanger: true,
    },
    latestTurnRiskLevel: 'urgent',
    activeIncidentRiskLevel: 'high',
    conversationState: {
      priorEvidenceUploadTurns: 0,
    }
  });

  assert.match(aiReply.assistantMessage, /Only if you choose|should only analyse/i);
  assert.match(aiReply.assistantMessage, /call 000/i);
  assert.match(aiReply.nextQuestion, /without AI analysis|AI analysis later/i);
  assert.equal((`${aiReply.assistantMessage} ${aiReply.nextQuestion}`.match(/\?/g) ?? []).length, 1);
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
