const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const exportPath = path.join(os.tmpdir(), 'safespeak-report-delivery-tests');

process.env.REPORT_DELIVERY_EXPORT_PATH = exportPath;
process.env.SAFESPEAK_TEST_DELIVERY_TOKEN = 'test-partner-token';
process.env.SAFESPEAK_TEST_EMAIL_WEBHOOK_URL = 'https://partner.example.test/email';
process.env.SAFESPEAK_TEST_EMAIL_WEBHOOK_TOKEN = 'test-email-token';

const {
  executeReportDelivery,
  getDestinationDeliveryReadiness
} = require('../src/modules/reports/reports-delivery.service.ts');

function destination(overrides = {}) {
  return {
    _id: '0123456789abcdef01234567',
    key: 'test-partner',
    type: 'police',
    name: 'Test Partner',
    channel: 'api_oauth',
    jurisdiction: 'NSW',
    languages: ['en'],
    endpoint: 'https://partner.example.test/reports',
    contactEmail: 'handoff@example.test',
    metadata: {},
    ...overrides
  };
}

function deliveryInput(overrides = {}) {
  return {
    submissionId: 'abcdefabcdefabcdefabcdef',
    refNo: 'SSR-TEST-DELIVERY',
    destination: destination(),
    template: null,
    payload: {
      refNo: 'SSR-TEST-DELIVERY',
      title: 'SafeSpeak test report'
    },
    ...overrides
  };
}

test('API delivery readiness uses destination credential env references', () => {
  const readiness = getDestinationDeliveryReadiness(
    destination({
      metadata: {
        authTokenEnvKey: 'SAFESPEAK_TEST_DELIVERY_TOKEN'
      }
    })
  );

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.mode, 'automated');
  assert.equal(readiness.canAutoSend, true);
  assert.equal(readiness.actuallySends, true);
  assert.equal(readiness.credentialConfigured, true);
  assert.equal(readiness.credentialReference, 'SAFESPEAK_TEST_DELIVERY_TOKEN');
  assert.deepEqual(readiness.configurationIssues, []);
});

test('API delivery records config_missing instead of sending when endpoint config is incomplete', async () => {
  const result = await executeReportDelivery(
    deliveryInput({
      destination: destination({
        endpoint: undefined,
        metadata: {
          authTokenEnvKey: 'SAFESPEAK_TEST_DELIVERY_TOKEN'
        }
      })
    })
  );

  assert.equal(result.status, 'config_missing');
  assert.equal(result.deliveryMode, 'config_missing');
  assert.equal(result.deliveryConfigurationStatus, 'config_missing');
  assert.equal(result.actuallySent, false);
  assert.match(result.message ?? '', /API endpoint is not configured/);
});

test('API delivery sends with bearer credential and marks acknowledged when partner returns a reference', async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, init) => {
    calls.push({ url, init });

    return new Response('accepted', {
      status: 202,
      headers: {
        'x-reference-id': 'ACK-TEST-1'
      }
    });
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await executeReportDelivery(
    deliveryInput({
      destination: destination({
        metadata: {
          authTokenEnvKey: 'SAFESPEAK_TEST_DELIVERY_TOKEN'
        }
      })
    })
  );

  assert.equal(result.status, 'acknowledged');
  assert.equal(result.externalReference, 'ACK-TEST-1');
  assert.equal(result.actuallySent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://partner.example.test/reports');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-partner-token');
});

test('manual handoff destinations prepare artifacts without claiming external delivery', async (t) => {
  t.after(() => {
    fs.rmSync(exportPath, { recursive: true, force: true });
  });

  const readiness = getDestinationDeliveryReadiness(
    destination({
      channel: 'booking_link',
      endpoint: 'https://partner.example.test/book'
    })
  );
  const result = await executeReportDelivery(
    deliveryInput({
      destination: destination({
        channel: 'booking_link',
        endpoint: 'https://partner.example.test/book'
      })
    })
  );

  assert.equal(readiness.status, 'manual_action');
  assert.equal(readiness.mode, 'manual');
  assert.equal(result.status, 'requires_manual_action');
  assert.equal(result.deliveryConfigurationStatus, 'manual_action');
  assert.equal(result.actuallySent, false);
  assert.equal(result.deliveryArtifacts?.[0]?.url, 'https://partner.example.test/book');
});

test('secure email readiness requires webhook URL and token before automated delivery', () => {
  const readiness = getDestinationDeliveryReadiness(
    destination({
      channel: 'secure_email_pgp',
      metadata: {
        emailWebhookUrlEnvKey: 'SAFESPEAK_TEST_EMAIL_WEBHOOK_URL',
        emailWebhookTokenEnvKey: 'SAFESPEAK_TEST_EMAIL_WEBHOOK_TOKEN'
      }
    })
  );

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.mode, 'automated');
  assert.equal(readiness.actuallySends, true);
  assert.equal(readiness.credentialReference, 'SAFESPEAK_TEST_EMAIL_WEBHOOK_TOKEN');
});
