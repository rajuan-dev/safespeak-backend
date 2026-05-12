import {
  SAFE_SPEAK_DESTINATION_CHANNELS,
  SAFE_SPEAK_DESTINATION_TYPES
} from '@modules/scope/scope.constants';

export const ADMIN_ACTIONS = {
  dashboard: 'admin.dashboard',
  usersList: 'admin.users.list',
  userCreate: 'admin.users.create',
  userUpdate: 'admin.users.update',
  taxonomiesList: 'admin.taxonomies.list',
  taxonomyCreate: 'admin.taxonomies.create',
  taxonomyUpdate: 'admin.taxonomies.update',
  destinationsList: 'admin.destinations.list',
  destinationCreate: 'admin.destinations.create',
  destinationUpdate: 'admin.destinations.update',
  submissionTemplatesList: 'admin.submission_templates.list',
  submissionTemplateCreate: 'admin.submission_templates.create',
  submissionTemplateUpdate: 'admin.submission_templates.update',
  knowledgeSourcesList: 'admin.knowledge_sources.list',
  educationalContentOverview: 'admin.educational_content.overview',
  privacyRequestsList: 'admin.privacy_requests.list',
  privacyRequestUpdate: 'admin.privacy_requests.update',
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
export const PRIVACY_REQUEST_STATUSES = ['pending', 'in_review', 'completed', 'rejected'] as const;
