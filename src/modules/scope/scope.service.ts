import {
  SAFE_SPEAK_ANALYTICS_POLICY,
  SAFE_SPEAK_CONSENT_FLAGS,
  SAFE_SPEAK_DESTINATION_CHANNELS,
  SAFE_SPEAK_DESTINATION_TYPES,
  SAFE_SPEAK_JURISDICTIONS,
  SAFE_SPEAK_MICRO_EDUCATION_CATEGORIES,
  SAFE_SPEAK_REPORT_STATUSES,
  SAFE_SPEAK_SCAM_ANALYSIS_TYPES,
  SAFE_SPEAK_SCOPE_VERSION,
} from './scope.constants';
import {
  getProfileCultureLabels,
  getTaxonomyCatalog,
  toScopeLanguageOptions
} from '@modules/taxonomies/taxonomies.service';

export const getScopeBootstrap = async () => {
  const taxonomyCatalog = await getTaxonomyCatalog();

  return {
    scopeVersion: SAFE_SPEAK_SCOPE_VERSION,
    jurisdictions: SAFE_SPEAK_JURISDICTIONS,
    languages: toScopeLanguageOptions(taxonomyCatalog.languages),
    culturalProfiles: getProfileCultureLabels(taxonomyCatalog.cultures, 'cultural'),
    faithProfiles: getProfileCultureLabels(taxonomyCatalog.cultures, 'faith'),
    communityProfiles: getProfileCultureLabels(taxonomyCatalog.cultures, 'community'),
    consentFlags: SAFE_SPEAK_CONSENT_FLAGS,
    incidentTypes: taxonomyCatalog.incidentTypes.map((record) => record.key),
    supportNeeds: taxonomyCatalog.supportNeeds.map((record) => record.key),
    destinationTypes: SAFE_SPEAK_DESTINATION_TYPES,
    destinationChannels: SAFE_SPEAK_DESTINATION_CHANNELS,
    reportStatuses: SAFE_SPEAK_REPORT_STATUSES,
    scamAnalysisTypes: SAFE_SPEAK_SCAM_ANALYSIS_TYPES,
    microEducationCategories: SAFE_SPEAK_MICRO_EDUCATION_CATEGORIES,
    analyticsPolicy: SAFE_SPEAK_ANALYTICS_POLICY,
    taxonomies: taxonomyCatalog
  };
};

export const getScopeBlueprint = async () => ({
  ...(await getScopeBootstrap()),
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
