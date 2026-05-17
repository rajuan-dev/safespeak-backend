export const CONVERSATION_FLOW_STATUSES = [
  'active',
  'ready_for_triage',
  'triaged',
  'recommendation_ready',
  'completed'
] as const;

export const CONVERSATION_FLOW_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;

export const CONVERSATION_FLOW_RISK_LEVELS = ['low', 'medium', 'high', 'immediate'] as const;

export const CONVERSATION_FLOW_CATEGORIES = [
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

export const CONVERSATION_FLOW_ACTIONS = {
  sessionCreate: 'conversation_flow.session.create',
  sessionGet: 'conversation_flow.session.get',
  messageAppend: 'conversation_flow.message.append',
  triageGet: 'conversation_flow.triage.get',
  supportGet: 'conversation_flow.support.get',
  recommendationsGet: 'conversation_flow.recommendations.get',
  detailsGet: 'conversation_flow.details.get'
} as const;
