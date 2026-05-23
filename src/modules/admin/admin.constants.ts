import {
  SAFE_SPEAK_DESTINATION_CHANNELS,
  SAFE_SPEAK_DESTINATION_TYPES
} from '@modules/scope/scope.constants';

export const ADMIN_ACTIONS = {
  dashboard: 'admin.dashboard',
  auditLogsList: 'admin.audit_logs.list',
  usersList: 'admin.users.list',
  userCreate: 'admin.users.create',
  userUpdate: 'admin.users.update',
  taxonomiesList: 'admin.taxonomies.list',
  taxonomyGet: 'admin.taxonomies.get',
  taxonomyCreate: 'admin.taxonomies.create',
  taxonomyUpdate: 'admin.taxonomies.update',
  taxonomyDelete: 'admin.taxonomies.delete',
  destinationsList: 'admin.destinations.list',
  destinationCreate: 'admin.destinations.create',
  destinationUpdate: 'admin.destinations.update',
  submissionTemplatesList: 'admin.submission_templates.list',
  submissionTemplateCreate: 'admin.submission_templates.create',
  submissionTemplateUpdate: 'admin.submission_templates.update',
  reportDeliveriesList: 'admin.report_deliveries.list',
  knowledgeSourcesList: 'admin.knowledge_sources.list',
  educationalContentOverview: 'admin.educational_content.overview',
  dataProtectionOverview: 'admin.data_protection.overview',
  aiEngineOverview: 'admin.ai_engine.overview',
  languagePacksOverview: 'admin.language_packs.overview',
  intelligenceCenterOverview: 'admin.intelligence_center.overview',
  culturalProfilesOverview: 'admin.cultural_profiles.overview',
  culturalProfilesList: 'admin.cultural_profiles.list',
  culturalProfileCreate: 'admin.cultural_profiles.create',
  culturalProfileUpdate: 'admin.cultural_profiles.update',
  culturalProfileDelete: 'admin.cultural_profiles.delete',
  privacyRequestsList: 'admin.privacy_requests.list',
  privacyRequestUpdate: 'admin.privacy_requests.update',
  notificationsList: 'admin.notifications.list',
  notificationRead: 'admin.notifications.read',
  notificationsReadAll: 'admin.notifications.read_all',
  analyticsOverview: 'admin.analytics.overview'
} as const;

export const ADMIN_TAXONOMY_TYPES = [
  'incident_type',
  'support_need',
  'language',
  'culture'
] as const;
export const ADMIN_DESTINATION_TYPES = SAFE_SPEAK_DESTINATION_TYPES;
export const ADMIN_DESTINATION_CHANNELS = SAFE_SPEAK_DESTINATION_CHANNELS;
export const ADMIN_SUBMISSION_TEMPLATE_ACK_MODES = [
  'manual',
  'sync_reference',
  'async_webhook'
] as const;
export const ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES = [
  'metadata_only',
  'include_hashes',
  'include_manifest'
] as const;
export const ADMIN_CULTURAL_PROFILE_TYPES = ['cultural', 'faith', 'community'] as const;
export const ADMIN_CULTURAL_PROFILE_STATUSES = [
  'draft',
  'pending_review',
  'validated',
  'needs_update',
  'archived'
] as const;
export const PRIVACY_REQUEST_STATUSES = ['pending', 'in_review', 'completed', 'rejected'] as const;
