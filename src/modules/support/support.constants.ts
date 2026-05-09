export const SUPPORT_ACTIONS = {
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
  'community'
] as const;

export const SUPPORT_REQUEST_STATUSES = ['pending', 'accepted', 'completed', 'cancelled'] as const;

export interface SupportServiceDefinition {
  id: string;
  name: string;
  type: (typeof SUPPORT_SERVICE_TYPES)[number];
  description: string;
  phone?: string;
  url?: string;
  jurisdiction: string;
  languages: readonly string[];
  informationOnly: boolean;
}

export const DEFAULT_SUPPORT_SERVICES: readonly SupportServiceDefinition[] = [
  {
    id: '1800respect',
    name: '1800RESPECT',
    type: 'crisis',
    description: 'National counselling and support service.',
    phone: '1800 737 732',
    jurisdiction: 'AU',
    languages: ['en'],
    informationOnly: true
  },
  {
    id: 'lifeline',
    name: 'Lifeline',
    type: 'crisis',
    description: '24/7 crisis support and suicide prevention service.',
    phone: '13 11 14',
    jurisdiction: 'AU',
    languages: ['en'],
    informationOnly: true
  }
];
