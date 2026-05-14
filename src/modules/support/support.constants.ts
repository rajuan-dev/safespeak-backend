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
    phone: '1300 888 529',
    websiteUrl: 'https://www.legalaid.nsw.gov.au/contact-us',
    url: 'https://www.legalaid.nsw.gov.au/contact-us',
    jurisdiction: 'AU',
    regions: ['NSW', 'national'],
    languages: ['en'],
    eligibility: ['legal_help', 'racial_abuse', 'domestic_violence'],
    crisis: false,
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
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    url: 'https://www.1800respect.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['community_support', 'racial_abuse', 'migrant_support'],
    crisis: false,
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
    phone: '13 11 14',
    websiteUrl: 'https://www.lifeline.org.au',
    url: 'https://www.lifeline.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['mental_health', 'domestic_violence', 'migrant_support'],
    crisis: false,
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
    phone: '1800 022 222',
    websiteUrl: 'https://www.healthdirect.gov.au/contact-us',
    url: 'https://www.healthdirect.gov.au/contact-us',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['health', 'migrant_support'],
    crisis: false,
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
    phone: '1800 353 374',
    websiteUrl: 'https://www.health.gov.au/contacts/elder-abuse-phone-line',
    url: 'https://www.health.gov.au/contacts/elder-abuse-phone-line',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['elder_support', 'community_support'],
    crisis: false,
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
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    url: 'https://www.1800respect.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['crisis', 'domestic_violence', 'safety_plan'],
    crisis: true,
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
    websiteUrl: 'https://www.esafety.gov.au/report',
    url: 'https://www.esafety.gov.au/report',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['online_safety', 'cyber_scam'],
    crisis: false,
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
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    url: 'https://www.1800respect.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['domestic_violence', 'sexual_violence', 'family_violence'],
    crisis: true,
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
    phone: '13 11 14',
    websiteUrl: 'https://www.lifeline.org.au',
    url: 'https://www.lifeline.org.au',
    jurisdiction: 'AU',
    regions: ['national'],
    languages: ['en'],
    eligibility: ['crisis', 'mental_health', 'suicide_prevention'],
    crisis: true,
    isPublished: true,
    isActive: true,
    informationOnly: true
  }
];
