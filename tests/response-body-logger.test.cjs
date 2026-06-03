const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isConversationMessageAppendRoute,
  summarizeResponseBodyForLogging,
} = require('../src/common/middleware/response-body-logger.middleware.ts');
const {
  summarizeRequestBodyForLogging,
} = require('../src/common/middleware/request-logger.middleware.ts');

test('conversation message append route detection matches only conversation message posts', () => {
  assert.equal(
    isConversationMessageAppendRoute({
      method: 'POST',
      originalUrl: '/api/v1/conversation-flow/sessions/abc123/messages'
    }),
    true
  );
  assert.equal(
    isConversationMessageAppendRoute({
      method: 'GET',
      originalUrl: '/api/v1/conversation-flow/sessions/abc123/messages'
    }),
    false
  );
  assert.equal(
    isConversationMessageAppendRoute({
      method: 'POST',
      originalUrl: '/api/v1/platform-settings'
    }),
    false
  );
});

test('conversation message response body logging is reduced to compact metadata by default', () => {
  const summary = summarizeResponseBodyForLogging({
    request: {
      method: 'POST',
      originalUrl: '/api/v1/conversation-flow/sessions/6a1/messages'
    },
    body: {
      success: true,
      message: 'Conversation turn recorded',
      timestamp: '2026-06-03T09:53:35.012Z',
      requestId: 'req-1',
      data: {
        session: {
          id: '6a1',
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
          createdAt: 'keep-out',
          updatedAt: 'keep-out'
        },
        userMessage: {
          id: 'u1',
          role: 'user',
          content: 'hi',
          turnNumber: 1,
          metadata: {},
          createdAt: 'keep-out'
        },
        assistantMessage: {
          id: 'a1',
          role: 'assistant',
          content: 'Hi there.',
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
              store_local: true
            }
          },
          createdAt: 'keep-out'
        },
        factExtraction: {
          shouldNot: 'appear'
        },
        triage: null,
        transition: {
          offerTriage: false
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
      }
    }
  });

  assert.equal(summary.success, true);
  assert.equal(summary.conversation.sessionId, '6a1');
  assert.equal(summary.conversation.latestUserMessageFirst120, 'hi');
  assert.equal(summary.conversation.assistantResponseFirst120, 'Hi there.');
  assert.equal(summary.conversation.detectedIntent, 'general_conversation');
  assert.equal(summary.conversation.responseSource, 'openai_model');
  assert.deepEqual(summary.conversation.triageSummary, { exists: false });
  assert.equal('data' in summary, false);
});

test('non-conversation response body logging remains unchanged', () => {
  const original = {
    success: true,
    message: 'Platform settings retrieved',
    data: {
      platformSettings: {
        settings: {
          ai: {
            disclaimerText: 'keep me'
          }
        }
      }
    }
  };

  const summary = summarizeResponseBodyForLogging({
    request: {
      method: 'GET',
      originalUrl: '/api/v1/platform-settings'
    },
    body: original
  });

  assert.deepEqual(summary, original);
});

test('conversation message response body logging keeps full body when debugFullResponse is enabled', () => {
  const original = {
    success: true,
    data: {
      session: {
        id: 'session-1'
      },
      assistantMessage: {
        content: 'Full response should stay visible here.'
      }
    }
  };

  const summary = summarizeResponseBodyForLogging({
    request: {
      method: 'POST',
      originalUrl: '/api/v1/conversation-flow/sessions/session-1/messages'
    },
    body: original,
    debugFullResponse: true
  });

  assert.deepEqual(summary, original);
});

test('conversation message request body logging is reduced to a preview by default', () => {
  const summary = summarizeRequestBodyForLogging(
    {
      method: 'POST',
      originalUrl: '/api/v1/conversation-flow/sessions/session-1/messages'
    },
    {
      content: 'hello there this is a test message',
      language: 'en',
      debugResponse: 'minimal',
      ignored: 'field'
    }
  );

  assert.deepEqual(summary, {
    contentPreview: 'hello there this is a test message',
    language: 'en',
    debugResponse: 'minimal'
  });
});
