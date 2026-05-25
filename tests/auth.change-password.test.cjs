const assert = require('node:assert/strict');
const test = require('node:test');

const {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateCurrentUserProfileSchema,
  verifyPasswordResetOtpSchema
} = require('../src/modules/auth/auth.schema.ts');
const { helpSupportRequestSchema } = require('../src/modules/support/support.schema.ts');
const {
  adminNotificationsQuerySchema,
  markAdminNotificationReadSchema,
  markAdminNotificationsReadSchema
} = require('../src/modules/admin/admin.schema.ts');
const {
  adminFeedbackQuerySchema,
  feedbackSubmissionSchema,
  updateAdminFeedbackSchema
} = require('../src/modules/feedback/feedback.schema.ts');
const {
  contentPageParamsSchema,
  contentPageUpdateSchema,
  legalDocumentContentSchema
} = require('../src/modules/content-pages/content-pages.schema.ts');
const {
  protectAnalyticsExportCount,
  sampleLaplaceNoise
} = require('../src/modules/analytics/analytics.service.ts');

test('changePasswordSchema accepts the existing admin form password length', () => {
  const result = changePasswordSchema.safeParse({
    currentPassword: 'existing-password',
    newPassword: '12345678'
  });

  assert.equal(result.success, true);
});

test('changePasswordSchema rejects an empty current password', () => {
  const result = changePasswordSchema.safeParse({
    currentPassword: '',
    newPassword: '12345678'
  });

  assert.equal(result.success, false);
});

test('helpSupportRequestSchema accepts the settings support form shape', () => {
  const result = helpSupportRequestSchema.safeParse({
    title: 'Account help',
    message: 'I need help with my SafeSpeak settings.'
  });

  assert.equal(result.success, true);
});

test('forgotPasswordSchema defaults to admin password recovery', () => {
  const result = forgotPasswordSchema.parse({
    email: 'admin@example.com'
  });

  assert.equal(result.audience, 'admin');
});

test('verifyPasswordResetOtpSchema requires a 4 digit code', () => {
  const result = verifyPasswordResetOtpSchema.safeParse({
    email: 'admin@example.com',
    audience: 'admin',
    resetRequestId: '0123456789abcdef01234567',
    otp: '1234'
  });
  const invalid = verifyPasswordResetOtpSchema.safeParse({
    email: 'admin@example.com',
    audience: 'admin',
    resetRequestId: '0123456789abcdef01234567',
    otp: '12345'
  });

  assert.equal(result.success, true);
  assert.equal(invalid.success, false);
});

test('resetPasswordSchema accepts the admin reset screen password length', () => {
  const result = resetPasswordSchema.safeParse({
    email: 'admin@example.com',
    audience: 'admin',
    resetRequestId: '0123456789abcdef01234567',
    resetToken: 'abcdefghijklmnopqrstuvwxyz1234567890',
    newPassword: '12345678'
  });

  assert.equal(result.success, true);
});

test('updateCurrentUserProfileSchema accepts admin profile form values', () => {
  const result = updateCurrentUserProfileSchema.safeParse({
    fullName: 'SafeSpeak Admin',
    email: 'admin@example.com',
    contactNo: '+1 222 333 4444'
  });

  assert.equal(result.success, true);
});

test('admin notification schemas accept current notification controls', () => {
  const query = adminNotificationsQuerySchema.parse({});
  const readOne = markAdminNotificationReadSchema.safeParse({
    notificationId: 'audit:0123456789abcdef01234567'
  });
  const readAll = markAdminNotificationsReadSchema.safeParse({
    notificationIds: ['audit:0123456789abcdef01234567']
  });

  assert.equal(query.limit, 50);
  assert.equal(readOne.success, true);
  assert.equal(readAll.success, true);
});

test('feedback schemas accept public submissions and admin feedback management updates', () => {
  const submission = feedbackSubmissionSchema.parse({
    name: 'Robert Fox',
    email: 'fox@example.com',
    phone: '+12313412',
    subject: 'Admin feedback',
    message: 'The feedback management screen should show this message.',
    rating: '5'
  });
  const query = adminFeedbackQuerySchema.parse({});
  const update = updateAdminFeedbackSchema.safeParse({
    status: 'in_review',
    adminNotes: 'Reviewed by admin.'
  });
  const emptyUpdate = updateAdminFeedbackSchema.safeParse({});

  assert.equal(submission.source, 'user_feedback');
  assert.equal(submission.rating, 5);
  assert.equal(query.limit, 50);
  assert.equal(update.success, true);
  assert.equal(emptyUpdate.success, false);
});

test('content page schemas accept admin legal document updates', () => {
  const params = contentPageParamsSchema.safeParse({ key: 'privacy-policy' });
  const update = contentPageUpdateSchema.safeParse({
    content: {
      contentHtml: '<p>Updated privacy copy.</p>'
    }
  });
  const document = legalDocumentContentSchema.safeParse(update.success ? update.data.content : {});

  assert.equal(params.success, true);
  assert.equal(update.success, true);
  assert.equal(document.success, true);
});

test('content page legal document schema rejects unsafe embedded HTML', () => {
  const result = legalDocumentContentSchema.safeParse({
    contentHtml: '<script>alert("x")</script><p>Policy copy.</p>'
  });

  assert.equal(result.success, false);
});

test('analytics export suppresses low-count cells before noise', () => {
  const result = protectAnalyticsExportCount(4, {
    minimumCellSize: 5,
    rng: () => 0.99
  });

  assert.equal(result.suppressed, true);
  assert.equal(result.noiseApplied, false);
  assert.equal(result.count, undefined);
  assert.match(result.label, /fewer than 5/);
});

test('analytics export applies Laplace noise to eligible counts', () => {
  const noise = sampleLaplaceNoise(1, 1, () => 0.75);
  const result = protectAnalyticsExportCount(10, {
    rng: () => 0.75
  });

  assert.equal(Number(noise.toFixed(6)), Number((-Math.log(0.5)).toFixed(6)));
  assert.equal(result.suppressed, false);
  assert.equal(result.noiseApplied, true);
  assert.equal(result.count, 11);
});
