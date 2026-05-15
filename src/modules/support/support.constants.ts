export const SUPPORT_ACTIONS = {
  adminServicesList: 'support.admin.services.list',
  adminServiceCreate: 'support.admin.services.create',
  adminServiceUpdate: 'support.admin.services.update',
  adminServiceDelete: 'support.admin.services.delete',
  adminWarmReferralsList: 'support.admin.warm_referrals.list',
  adminWarmReferralUpdate: 'support.admin.warm_referrals.update',
  servicesList: 'support.services.list',
  serviceGet: 'support.services.get',
  recommendations: 'support.recommendations',
  warmReferral: 'support.warm_referral',
  advocatesList: 'support.advocates.list',
  advocateRequest: 'support.advocate_request',
  safetyPlanList: 'support.safety_plan.list',
  safetyPlanCreate: 'support.safety_plan.create',
  safetyPlanUpdate: 'support.safety_plan.update'
} as const;

export const SUPPORT_SERVICE_TYPES = [
  'counselling',
  'legal_information',
  'housing',
  'financial',
  'crisis',
  'community',
  'health',
  'online_safety'
] as const;

export const SUPPORT_RESOURCE_TYPES = [
  'emergency',
  'police',
  'government',
  'legal',
  'mental_health',
  'domestic_violence_agency',
  'workplace_body',
  'anti_discrimination_body',
  'council_support',
  'evidence_guidance',
  'safety_planning',
  'scam_support',
  'online_safety'
] as const;

export const SUPPORT_ISSUE_TYPES = [
  'domestic_violence',
  'workplace_bullying',
  'racism_discrimination',
  'online_abuse',
  'scam_fraud',
  'theft_property',
  'harassment',
  'mental_health_distress',
  'general_support'
] as const;

export const SUPPORT_RESOURCE_RISK_LEVELS = [
  'low',
  'medium',
  'high',
  'immediate',
  'all'
] as const;

export const SUPPORT_SERVICE_CARD_ICONS = [
  'scale',
  'shield',
  'phone',
  'community',
  'counselling',
  'home',
  'bell',
  'sparkles'
] as const;

export const SUPPORT_SERVICE_OVERLAY_TONES = [
  'default',
  'dark',
  'blue',
  'red',
  'brown',
  'purple'
] as const;

export const SUPPORT_REQUEST_STATUSES = ['pending', 'accepted', 'completed', 'cancelled'] as const;

export interface SupportServiceDefinition {
  id: string;
  key?: string;
  name: string;
  type: (typeof SUPPORT_SERVICE_TYPES)[number];
  description: string;
  cardImageUrl?: string;
  cardImageAlt?: string;
  cardIcon?: (typeof SUPPORT_SERVICE_CARD_ICONS)[number];
  cardOverlayTone?: (typeof SUPPORT_SERVICE_OVERLAY_TONES)[number];
  availabilityLabel?: string;
  referralTitle?: string;
  referralDescription?: string;
  resourceType?: (typeof SUPPORT_RESOURCE_TYPES)[number];
  issueTypes?: readonly (typeof SUPPORT_ISSUE_TYPES)[number][];
  safetyRiskLevels?: readonly (typeof SUPPORT_RESOURCE_RISK_LEVELS)[number][];
  ctaLabel?: string;
  resourceLinks?: readonly {
    label: string;
    url: string;
  }[];
  phone?: string;
  email?: string;
  websiteUrl?: string;
  bookingUrl?: string;
  address?: string;
  url?: string;
  jurisdiction: string;
  regions?: readonly string[];
  languages: readonly string[];
  eligibility?: readonly string[];
  crisis?: boolean;
  priority?: number;
  safetyNotes?: string;
  eligibilityNotes?: string;
  languageSupportNotes?: string;
  isPublished?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
  informationOnly: boolean;
}

export const DEFAULT_SUPPORT_SERVICES: readonly SupportServiceDefinition[] = [
  {
    id: 'legal-aid',
    name: 'Legal Aid NSW',
    type: 'legal_information',
    description: 'Legal information and referral pathways for people who need help understanding their options.',
    cardIcon: 'scale',
    cardOverlayTone: 'dark',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'legal',
    issueTypes: ['workplace_bullying', 'racism_discrimination', 'general_support'],
    safetyRiskLevels: ['low', 'medium', 'high'],
    ctaLabel: 'Contact Legal Aid',
    phone: '1300 888 529',
    websiteUrl: 'https://www.legalaid.nsw.gov.au/contact-us',
    url: 'https://www.legalaid.nsw.gov.au/contact-us',
    jurisdiction: 'AU',
    regions: ['NSW', 'national'],
    languages: ['en'],
    eligibility: ['legal_help', 'racial_abuse', 'domestic_violence'],
    crisis: false,
    priority: 72,
    safetyNotes: 'Use when the person wants legal information or rights guidance.',
    eligibilityNotes: 'Useful for legal information and referral support.',
    languageSupportNotes: 'Interpreter options depend on the service.',
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'community-support',
    name: 'Community Support',
    type: 'community',
    description: 'Community-based support options for practical next steps and local service navigation.',
    cardIcon: 'community',
    cardOverlayTone: 'blue',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'council_support',
    issueTypes: ['domestic_violence', 'racism_discrimination', 'general_support'],
    safetyRiskLevels: ['low', 'medium', 'high'],
    ctaLabel: 'Find local support',
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    url: 'https://www.1800respect.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['community_support', 'racial_abuse', 'migrant_support'],
    crisis: false,
    priority: 60,
    safetyNotes: 'Useful for local practical support and community referrals.',
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'counselling',
    name: 'Counselling Support',
    type: 'counselling',
    description: 'Confidential emotional support and counselling pathways for people who need someone to talk to.',
    cardIcon: 'counselling',
    cardOverlayTone: 'blue',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'mental_health',
    issueTypes: ['domestic_violence', 'harassment', 'mental_health_distress', 'general_support'],
    safetyRiskLevels: ['low', 'medium', 'high', 'immediate'],
    ctaLabel: 'Call Lifeline',
    phone: '13 11 14',
    websiteUrl: 'https://www.lifeline.org.au',
    url: 'https://www.lifeline.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['mental_health', 'domestic_violence', 'migrant_support'],
    crisis: false,
    priority: 80,
    languageSupportNotes: 'Ask about language support when calling.',
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'health-services',
    name: 'Healthdirect',
    type: 'health',
    description: '24/7 health advice from registered nurses and pathways to local care.',
    cardIcon: 'shield',
    cardOverlayTone: 'default',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'government',
    issueTypes: ['general_support', 'mental_health_distress'],
    safetyRiskLevels: ['low', 'medium'],
    ctaLabel: 'Contact Healthdirect',
    phone: '1800 022 222',
    websiteUrl: 'https://www.healthdirect.gov.au/contact-us',
    url: 'https://www.healthdirect.gov.au/contact-us',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['health', 'migrant_support'],
    crisis: false,
    priority: 55,
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'elder-support',
    name: 'Elder Support',
    type: 'community',
    description: 'Confidential information, advice, and referral options for elder abuse concerns.',
    cardIcon: 'home',
    cardOverlayTone: 'brown',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'council_support',
    issueTypes: ['general_support'],
    safetyRiskLevels: ['low', 'medium'],
    ctaLabel: 'View elder support',
    phone: '1800 353 374',
    websiteUrl: 'https://www.health.gov.au/contacts/elder-abuse-phone-line',
    url: 'https://www.health.gov.au/contacts/elder-abuse-phone-line',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['elder_support', 'community_support'],
    crisis: false,
    priority: 40,
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'crisis-support',
    name: '1800RESPECT',
    type: 'crisis',
    description: 'National domestic, family and sexual violence counselling, information and support.',
    cardIcon: 'bell',
    cardOverlayTone: 'red',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'domestic_violence_agency',
    issueTypes: ['domestic_violence', 'harassment'],
    safetyRiskLevels: ['high', 'immediate'],
    ctaLabel: 'Call 1800RESPECT',
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    url: 'https://www.1800respect.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['crisis', 'domestic_violence', 'safety_plan'],
    crisis: true,
    priority: 100,
    safetyNotes: 'Escalate to emergency services when immediate danger is present.',
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'online-safety',
    name: 'eSafety Commissioner',
    type: 'online_safety',
    description: 'Online safety reporting pathways for serious online abuse and harmful online content.',
    cardIcon: 'shield',
    cardOverlayTone: 'purple',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'online_safety',
    issueTypes: ['online_abuse', 'scam_fraud'],
    safetyRiskLevels: ['low', 'medium', 'high'],
    ctaLabel: 'Visit eSafety',
    websiteUrl: 'https://www.esafety.gov.au/report',
    url: 'https://www.esafety.gov.au/report',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['online_safety', 'cyber_scam'],
    crisis: false,
    priority: 78,
    safetyNotes: 'Use for cyberbullying, image abuse, or other online abuse pathways.',
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: '1800respect',
    name: '1800RESPECT',
    type: 'crisis',
    description: 'National counselling and support service.',
    cardIcon: 'counselling',
    cardOverlayTone: 'dark',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'domestic_violence_agency',
    issueTypes: ['domestic_violence'],
    safetyRiskLevels: ['high', 'immediate'],
    ctaLabel: 'Call 1800RESPECT',
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    url: 'https://www.1800respect.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['domestic_violence', 'sexual_violence', 'family_violence'],
    crisis: true,
    priority: 98,
    isPublished: true,
    isActive: true,
    informationOnly: true
  },
  {
    id: 'lifeline',
    name: 'Lifeline',
    type: 'crisis',
    description: '24/7 crisis support and suicide prevention service.',
    cardIcon: 'bell',
    cardOverlayTone: 'blue',
    availabilityLabel: 'Available Now',
    referralTitle: 'Warm Referral',
    referralDescription:
      'A warm referral ensures the provider has the context they need to help you immediately without repeating your story. This secure transfer of information helps build trust and accelerates the support process.',
    resourceType: 'mental_health',
    issueTypes: ['mental_health_distress', 'harassment', 'general_support'],
    safetyRiskLevels: ['medium', 'high', 'immediate'],
    ctaLabel: 'Call Lifeline',
    phone: '13 11 14',
    websiteUrl: 'https://www.lifeline.org.au',
    url: 'https://www.lifeline.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['crisis', 'mental_health', 'suicide_prevention'],
    crisis: true,
    priority: 92,
    isPublished: true,
    isActive: true,
    informationOnly: true
  }
];
