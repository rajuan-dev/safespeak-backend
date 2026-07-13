const assert = require('node:assert/strict');
const test = require('node:test');

const { AuditLogModel } = require('../src/modules/audit/audit.model.ts');
const { ConsentRecordModel } = require('../src/modules/consent/consent.model.ts');
const { AdminDestinationModel, AdminSubmissionTemplateModel } = require('../src/modules/admin/admin.model.ts');
const { EvidenceModel } = require('../src/modules/evidence/evidence.model.ts');
const { ReportModel, ReportSubmissionModel } = require('../src/modules/reports/reports.model.ts');
const { submitReportToDestination } = require('../src/modules/reports/reports.service.ts');

const reportId = '64b000000000000000000001';
const destinationId = '6a0e038a0a296b9642533aa8';
const sessionId = '64b000000000000000000002';

function createReport(overrides = {}) {
  return {
    _id: reportId,
    refNo: 'SSR-TEST-SUBMISSION',
    sessionId,
    ownerType: 'anonymous',
    language: 'en',
    jurisdiction: 'NSW',
    context: 'SafeSpeak incident report',
    originalNarrative: 'A report summary for Legal Aid NSW.',
    incidentType: 'domestic_violence',
    structuredFields: {
      what: 'A report summary for Legal Aid NSW.',
      where: 'Sydney, NSW'
    },
    status: 'draft',
    statusHistory: [],
    save: async () => undefined,
    ...overrides
  };
}

function createDestination(overrides = {}) {
  return {
    _id: destinationId,
    key: 'legal-aid-nsw',
    type: 'legal_aid',
    name: 'Legal Aid NSW',
    channel: 'booking_link',
    jurisdiction: 'NSW',
    languages: ['en'],
    endpoint: 'https://www.legalaid.nsw.gov.au/ways-to-get-help/apply-for-legal-aid',
    contactPhone: '1300 888 529',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: ['Use the prepared summary to ask for information about legal options.'],
    consentRequired: true,
    supportsAcknowledgement: false,
    metadata: {
      incidentTypes: ['domestic_violence'],
      requiredConsentFlags: ['share_with_agencies']
    },
    ...overrides
  };
}

function createSubmission(overrides = {}) {
  const submission = {
    _id: '64b000000000000000000003',
    reportId,
    sessionId,
    ownerType: 'anonymous',
    destinationId,
    destinationKey: 'legal-aid-nsw',
    destinationType: 'legal_aid',
    destinationName: 'Legal Aid NSW',
    channel: 'booking_link',
    jurisdiction: 'NSW',
    languages: ['en'],
    status: 'requires_manual_action',
    anonymityMode: 'identified',
    minimumRequiredInfo: ['summary'],
    missingRequiredInfo: [],
    requiredConsentFlags: ['share_with_agencies'],
    expectedNextSteps: [],
    payloadSnapshot: {},
    evidenceSnapshot: [],
    consentSnapshot: { share_with_agencies: true },
    deliveryArtifacts: [],
    deliveryConfigurationIssues: [],
    actuallySent: false,
    toObject() {
      return { ...this };
    },
    ...overrides
  };

  return submission;
}

function createFindQuery(result) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    lean: async () => result
  };
}

function mockSubmissionDependencies(t, options = {}) {
  const report = options.report ?? createReport();
  const destination = options.destination ?? createDestination();
  const existingSubmission = options.existingSubmission ?? null;
  const createdSubmission = options.createdSubmission ?? createSubmission();
  let createCalls = 0;

  t.mock.method(ConsentRecordModel, 'findOne', () => ({
    sort: async () => ({
      flags: {
        cloud_sync: true,
        share_with_agencies: true
      }
    })
  }));
  t.mock.method(AuditLogModel, 'create', async () => ({}));
  t.mock.method(ReportModel, 'findOne', async () => report);
  t.mock.method(AdminDestinationModel, 'findOne', async () => destination);
  t.mock.method(AdminSubmissionTemplateModel, 'findOne', () => ({
    sort: async () => null
  }));
  t.mock.method(EvidenceModel, 'find', () => createFindQuery([]));
  t.mock.method(ReportSubmissionModel, 'findOne', () => ({
    sort: async () => existingSubmission
  }));
  t.mock.method(ReportSubmissionModel, 'create', async (payload) => {
    createCalls += 1;
    return createSubmission({
      ...payload,
      _id: createdSubmission._id,
      toObject: createdSubmission.toObject
    });
  });

  return {
    getCreateCalls: () => createCalls
  };
}

test('booking-link report submission creates one manual handoff record', async (t) => {
  const harness = mockSubmissionDependencies(t);

  const submission = await submitReportToDestination(
    { sessionId },
    reportId,
    {
      destinationId,
      anonymityMode: 'identified',
      notes: 'Please prepare a legal information handoff.',
      confirmConsent: true
    }
  );

  assert.equal(harness.getCreateCalls(), 1);
  assert.equal(submission.destinationId, destinationId);
  assert.equal(submission.status, 'requires_manual_action');
  assert.equal(submission.actuallySent, false);
});

test('duplicate active report submission returns existing record without creating another', async (t) => {
  const existingSubmission = createSubmission({ _id: '64b000000000000000000004' });
  const harness = mockSubmissionDependencies(t, { existingSubmission });

  const submission = await submitReportToDestination(
    { sessionId },
    reportId,
    {
      destinationId,
      anonymityMode: 'identified',
      confirmConsent: true
    }
  );

  assert.equal(harness.getCreateCalls(), 0);
  assert.equal(submission._id, existingSubmission._id);
});

test('destination incident-type metadata is enforced on direct submission', async (t) => {
  mockSubmissionDependencies(t, {
    destination: createDestination({
      metadata: {
        incidentTypes: ['scam_fraud'],
        requiredConsentFlags: ['share_with_agencies']
      }
    })
  });

  await assert.rejects(
    () =>
      submitReportToDestination(
        { sessionId },
        reportId,
        {
          destinationId,
          anonymityMode: 'identified',
          confirmConsent: true
        }
      ),
    /Destination does not support this report incident type/
  );
});
