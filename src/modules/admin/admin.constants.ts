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
export const ADMIN_DESTINATION_TYPES = ['agency', 'support_service', 'webhook'] as const;
export const PRIVACY_REQUEST_STATUSES = ['pending', 'in_review', 'completed', 'rejected'] as const;
