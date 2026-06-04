const assert = require('node:assert/strict');
const test = require('node:test');

const {
  analyzeSenderProfile,
  buildScamReportDraft,
  extractScamEntities
} = require('../src/modules/scamshield/scamshield.service.ts');

test('extractScamEntities captures bank references and transaction ids', () => {
  const entities = extractScamEntities(
    'Please send AUD 1,240 to the new BSB and account number. Payment reference INV-884421 and transaction ID TXN-778899.'
  );

  assert.match(entities.amounts[0] ?? '', /AUD 1,240/);
  assert.ok(entities.bankReferences.some((value) => /bsb/i.test(value)));
  assert.ok(entities.transactionIds.some((value) => /txn/i.test(value)));
});

test('analyzeSenderProfile detects authentication and routing mismatches', () => {
  const senderAnalysis = analyzeSenderProfile({
    subject: 'Verify now',
    from: 'alerts@paypal.example',
    body: 'Please verify your account.',
    forwardedWithPermission: true,
    headers: {
      'Authentication-Results':
        'mx.example; spf=fail smtp.mailfrom=spoof.example; dkim=fail header.d=spoof.example; dmarc=fail',
      'Reply-To': 'help@different.example',
      'Return-Path': '<mailer@different.example>'
    },
    metadata: {}
  });

  assert.equal(senderAnalysis.spf, 'fail');
  assert.equal(senderAnalysis.dkim, 'fail');
  assert.equal(senderAnalysis.dmarc, 'fail');
  assert.ok(senderAnalysis.signals.includes('reply-to mismatch'));
  assert.ok(senderAnalysis.signals.includes('dmarc failed'));
});

test('buildScamReportDraft can auto redact PII and expose destination helpers', async () => {
  const analysis = {
    riskLevel: 'high',
    riskScore: 82,
    confidence: 'high',
    summary: 'High scam risk detected.',
    indicators: ['credential request', 'known malicious host listing'],
    redFlags: ['The message asked for credentials.'],
    recommendations: ['Do not click the link.'],
    extractedEntities: {
      urls: ['https://evil.example/login'],
      emailAddresses: ['spoof@evil.example'],
      phoneNumbers: ['+61 400 000 000'],
      amounts: ['AUD 250'],
      paymentMethods: ['bank transfer'],
      organizations: ['paypal'],
      accountTerms: ['login'],
      cryptoReferences: [],
      bankReferences: ['account number'],
      transactionIds: ['TXN-778899'],
      urlSignals: ['sensitive action in link'],
      primaryUrlDomain: 'evil.example',
      possibleSender: 'spoof@evil.example'
    },
    metadata: {
      urlReputation: {
        domain: 'evil.example',
        signals: ['known malicious host listing']
      },
      senderAnalysis: {
        spf: 'fail',
        dkim: 'fail',
        dmarc: 'fail',
        signals: ['reply-to mismatch']
      }
    }
  };

  const draft = await buildScamReportDraft(analysis, {
    autoRedactPII: true,
    redactionMode: 'labels'
  });

  assert.match(draft.draft ?? '', /\[EMAIL\]/);
  assert.match(draft.draft ?? '', /\[URL\]/);
  assert.equal(draft.autoRedactPII, true);
  assert.equal(draft.destinations?.scamwatch?.downloadFileName, 'scamwatch-report-draft.txt');
  assert.equal(draft.destinations?.bank?.downloadFileName, 'bank-fraud-contact-template.txt');
});
