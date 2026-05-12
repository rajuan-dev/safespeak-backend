import {
  SAFE_SPEAK_ANALYTICS_POLICY,
  SAFE_SPEAK_COMMUNITY_PROFILES,
  SAFE_SPEAK_CONSENT_FLAGS,
  SAFE_SPEAK_CULTURAL_PROFILES,
  SAFE_SPEAK_DESTINATION_CHANNELS,
  SAFE_SPEAK_DESTINATION_TYPES,
  SAFE_SPEAK_FAITH_PROFILES,
  SAFE_SPEAK_INCIDENT_TYPES,
  SAFE_SPEAK_JURISDICTIONS,
  SAFE_SPEAK_MICRO_EDUCATION_CATEGORIES,
  SAFE_SPEAK_PRIORITY_LANGUAGE_OPTIONS,
  SAFE_SPEAK_REPORT_STATUSES,
  SAFE_SPEAK_SCAM_ANALYSIS_TYPES,
  SAFE_SPEAK_SCOPE_VERSION,
  SAFE_SPEAK_SUPPORT_NEEDS
} from './scope.constants';

export const getScopeBootstrap = () => ({
  scopeVersion: SAFE_SPEAK_SCOPE_VERSION,
  jurisdictions: SAFE_SPEAK_JURISDICTIONS,
  languages: SAFE_SPEAK_PRIORITY_LANGUAGE_OPTIONS,
  culturalProfiles: SAFE_SPEAK_CULTURAL_PROFILES,
  faithProfiles: SAFE_SPEAK_FAITH_PROFILES,
  communityProfiles: SAFE_SPEAK_COMMUNITY_PROFILES,
  consentFlags: SAFE_SPEAK_CONSENT_FLAGS,
  incidentTypes: SAFE_SPEAK_INCIDENT_TYPES,
  supportNeeds: SAFE_SPEAK_SUPPORT_NEEDS,
  destinationTypes: SAFE_SPEAK_DESTINATION_TYPES,
  destinationChannels: SAFE_SPEAK_DESTINATION_CHANNELS,
  reportStatuses: SAFE_SPEAK_REPORT_STATUSES,
  scamAnalysisTypes: SAFE_SPEAK_SCAM_ANALYSIS_TYPES,
  microEducationCategories: SAFE_SPEAK_MICRO_EDUCATION_CATEGORIES,
  analyticsPolicy: SAFE_SPEAK_ANALYTICS_POLICY
});

export const getScopeBlueprint = () => ({
  ...getScopeBootstrap(),
  entities: {
    report: {
      requiredFields: [
        'language',
        'jurisdiction',
        'lga',
        'context',
        'originalNarrative',
        'translatedNarrative',
        'incidentType',
        'severity',
        'structuredFields',
        'consentSnapshot',
        'status'
      ],
      structuredFieldGroups: [
        'who',
        'what',
        'when',
        'where',
        'how',
        'language_used',
        'repeated_incidents',
        'witnesses',
        'injuries',
        'evidence_items',
        'timeline'
      ]
    },
    evidenceAsset: {
      requiredFields: [
        'reportId',
        'type',
        'fileName',
        'mimeType',
        'size',
        'sha256Hash',
        'storageRegion',
        'consentSnapshot',
        'status'
      ],
      chainOfCustodyFields: ['sha256Hash', 'timestamp', 'uploaderId', 'signature', 'eventHash']
    },
    destination: {
      requiredFields: [
        'type',
        'name',
        'channel',
        'jurisdiction',
        'minimumRequiredInfo',
        'anonymityOptions',
        'expectedNextSteps',
        'consentRequired'
      ]
    },
    supportService: {
      requiredFields: [
        'type',
        'name',
        'jurisdiction',
        'languages',
        'contact',
        'warmReferralAvailable',
        'bookingLink',
        'informationOnly'
      ]
    },
    microEducation: {
      requiredFields: [
        'title',
        'summary',
        'category',
        'language',
        'format',
        'audience',
        'status'
      ]
    },
    knowledgeSource: {
      requiredFields: [
        'title',
        'sourceType',
        'jurisdiction',
        'language',
        'status',
        'legalReviewed',
        'content'
      ]
    }
  },
  adminResponsibilities: [
    'manage taxonomies',
    'manage destinations and templates',
    'manage languages and cultural profiles',
    'manage micro-education and content resources',
    'manage knowledge sources and legal-review readiness',
    'view anonymised analytics only'
  ]
});
