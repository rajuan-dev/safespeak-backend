const assert = require('node:assert/strict');
const test = require('node:test');

const {
  markUserNotificationReadSchema,
  markUserNotificationsReadSchema,
  userNotificationsQuerySchema
} = require('../src/modules/notifications/notifications.schema.ts');
const {
  buildPrivacyRequestNotification,
  buildReportStatusNotification,
  buildReportSubmissionNotification,
  buildSafetyPlanNotification,
  buildWarmReferralNotification
} = require('../src/modules/notifications/notifications.service.ts');

const reportId = '0123456789abcdef01234567';
const submissionId = 'abcdefabcdefabcdefabcdef';
const privacyRequestId = '111111111111111111111111';
const supportRequestId = '222222222222222222222222';
const safetyPlanId = '333333333333333333333333';

test('user notification schemas accept dashboard list and read controls', () => {
  const query = userNotificationsQuerySchema.parse({
    view: 'today',
    unreadOnly: 'true',
    limit: '25'
  });
  const readOne = markUserNotificationReadSchema.safeParse({
    notificationId: `report:${reportId}:status:submitted`
  });
  const readAll = markUserNotificationsReadSchema.safeParse({
    notificationIds: [
      `report:${reportId}:status:submitted`,
      `submission:${submissionId}:status:acknowledged`
    ]
  });

  assert.equal(query.view, 'today');
  assert.equal(query.unreadOnly, true);
  assert.equal(query.limit, 25);
  assert.equal(readOne.success, true);
  assert.equal(readAll.success, true);
});

test('report status notifications use the latest status event and safe report copy', () => {
  const submittedAt = new Date('2026-05-25T10:00:00.000Z');
  const notification = buildReportStatusNotification({
    _id: reportId,
    refNo: 'SSR-20260525-ABC123',
    status: 'submitted',
    statusHistory: [
      {
        status: 'draft',
        changedAt: new Date('2026-05-24T10:00:00.000Z')
      },
      {
        status: 'submitted',
        changedAt: submittedAt
      }
    ],
    createdAt: new Date('2026-05-24T09:00:00.000Z'),
    updatedAt: submittedAt
  });

  assert.equal(notification?.id, `report:${reportId}:status:submitted`);
  assert.equal(notification?.type, 'report_status');
  assert.equal(notification?.severity, 'success');
  assert.equal(notification?.createdAt.toISOString(), submittedAt.toISOString());
  assert.match(notification?.body ?? '', /Report SSR-20260525-ABC123/);
  assert.equal(notification?.actionHref, `/dashboard?view=reportoverview&reportId=${reportId}`);
});

test('report delivery notifications surface manual action and failure states', () => {
  const failedAt = new Date('2026-05-25T11:00:00.000Z');
  const notification = buildReportSubmissionNotification({
    _id: submissionId,
    reportId,
    destinationName: 'NSW Police',
    status: 'failed',
    createdAt: new Date('2026-05-25T10:30:00.000Z'),
    updatedAt: failedAt,
    lastAttemptAt: failedAt
  });

  assert.equal(notification?.id, `submission:${submissionId}:status:failed`);
  assert.equal(notification?.type, 'report_delivery');
  assert.equal(notification?.severity, 'critical');
  assert.match(notification?.body ?? '', /NSW Police/);
  assert.equal(
    notification?.actionHref,
    `/dashboard?view=reportsubmissionshare&reportId=${reportId}`
  );
});

test('privacy and support notification builders avoid sensitive free-text fields', () => {
  const privacyNotification = buildPrivacyRequestNotification({
    _id: privacyRequestId,
    requestType: 'data_deletion',
    status: 'in_review',
    createdAt: new Date('2026-05-25T08:00:00.000Z')
  });
  const supportNotification = buildWarmReferralNotification({
    _id: supportRequestId,
    serviceName: 'Legal Aid NSW',
    status: 'accepted',
    createdAt: new Date('2026-05-25T08:10:00.000Z')
  });

  assert.equal(privacyNotification?.type, 'privacy_request');
  assert.match(privacyNotification?.body ?? '', /data deletion/);
  assert.equal(supportNotification?.type, 'support_request');
  assert.match(supportNotification?.body ?? '', /Legal Aid NSW/);
});

test('inactive safety plans do not create dashboard notifications', () => {
  const activeNotification = buildSafetyPlanNotification({
    _id: safetyPlanId,
    title: 'Home safety plan',
    isActive: true,
    createdAt: new Date('2026-05-25T07:00:00.000Z')
  });
  const inactiveNotification = buildSafetyPlanNotification({
    _id: safetyPlanId,
    title: 'Inactive plan',
    isActive: false,
    createdAt: new Date('2026-05-25T07:00:00.000Z')
  });

  assert.equal(activeNotification?.id, `safety-plan:${safetyPlanId}:created`);
  assert.equal(activeNotification?.severity, 'success');
  assert.equal(inactiveNotification, undefined);
});
