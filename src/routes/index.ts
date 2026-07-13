import { Router } from 'express';

import { adminRoutes } from '@modules/admin/admin.routes';
import { aiRoutes } from '@modules/ai/ai.routes';
import { analyticsRoutes, publicAnalyticsRoutes } from '@modules/analytics/analytics.routes';
import { authRoutes } from '@modules/auth/auth.routes';
import { consentRoutes } from '@modules/consent/consent.routes';
import { conversationFlowRoutes } from '@modules/conversation-flow/conversation-flow.routes';
import { evidenceRoutes } from '@modules/evidence/evidence.routes';
import { adminFeedbackRoutes, feedbackRoutes } from '@modules/feedback/feedback.routes';
import { healthRoutes } from '@modules/health/health.routes';
import { adminContentPageRoutes, contentPageRoutes } from '@modules/content-pages/content-pages.routes';
import {
  adminContentResourceRoutes,
  contentResourceRoutes
} from '@modules/content-resources/content-resources.routes';
import {
  adminMicroEducationRoutes,
  microEducationRoutes
} from '@modules/microeducation/microeducation.routes';
import { notificationsRoutes } from '@modules/notifications/notifications.routes';
import {
  adminPlatformSettingsRoutes,
  platformSettingsRoutes
} from '@modules/platform-settings/platform-settings.routes';
import { adminMediaAssetRoutes, mediaAssetRoutes } from '@modules/media-assets/media-assets.routes';
import { profileRoutes } from '@modules/profile/profile.routes';
import { privacyRequestRoutes, privacyRoutes } from '@modules/privacy/privacy.routes';
import { ragRoutes } from '@modules/rag/rag.routes';
import { adminResourceRoutes, resourceRoutes } from '@modules/resources/resources.routes';
import { reportsRoutes } from '@modules/reports/reports.routes';
import { scamShieldRoutes } from '@modules/scamshield/scamshield.routes';
import { sessionsRoutes } from '@modules/sessions/sessions.routes';
import { scopeRoutes } from '@modules/scope/scope.routes';
import {
  adminAdvocateRoutes,
  adminSupportServiceRoutes,
  supportRoutes
} from '@modules/support/support.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/sessions', sessionsRoutes);
apiRouter.use('/consents', consentRoutes);
apiRouter.use('/conversation-flow', conversationFlowRoutes);
apiRouter.use('/', profileRoutes);
apiRouter.use('/platform-settings', platformSettingsRoutes);
apiRouter.use('/admin/platform-settings', adminPlatformSettingsRoutes);
apiRouter.use('/microeducation', microEducationRoutes);
apiRouter.use('/admin/microeducation', adminMicroEducationRoutes);
apiRouter.use('/content-pages', contentPageRoutes);
apiRouter.use('/admin/content-pages', adminContentPageRoutes);
apiRouter.use('/content-resources', contentResourceRoutes);
apiRouter.use('/admin/content-resources', adminContentResourceRoutes);
apiRouter.use('/media-assets', mediaAssetRoutes);
apiRouter.use('/admin/media-assets', adminMediaAssetRoutes);
apiRouter.use('/resources', resourceRoutes);
apiRouter.use('/admin/resources', adminResourceRoutes);
apiRouter.use('/reports', reportsRoutes);
apiRouter.use('/privacy-requests', privacyRequestRoutes);
apiRouter.use('/privacy', privacyRoutes);
apiRouter.use('/analytics', publicAnalyticsRoutes);
apiRouter.use('/', evidenceRoutes);
apiRouter.use('/ai', aiRoutes);
apiRouter.use('/rag', ragRoutes);
apiRouter.use('/scamshield', scamShieldRoutes);
apiRouter.use('/support', supportRoutes);
apiRouter.use('/feedback', feedbackRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/admin/advocates', adminAdvocateRoutes);
apiRouter.use('/admin/support-services', adminSupportServiceRoutes);
apiRouter.use('/admin/feedback', adminFeedbackRoutes);
apiRouter.use('/scope', scopeRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/admin/analytics', analyticsRoutes);
