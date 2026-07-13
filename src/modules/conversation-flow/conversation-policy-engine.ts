import {
  HIGH_IMPACT_LEGAL_PATTERN,
  SOURCE_GROUNDED_TOPIC_PATTERN
} from '@modules/ai/safespeak-legal-signals';

export type ConversationAssistantResponseMode =
  | 'legal_lookup'
  | 'triage_handoff'
  | 'evidence_upload_intent'
  | 'meta_feedback'
  | 'support_victim_style'
  | 'scamshield_style'
  | 'emergency_safety'
  | 'clarification_needed';

export type ConversationTurnResponseStrategy =
  | 'support_only'
  | 'pathway_guidance'
  | 'grounded_legal_information'
  | 'triage_handoff'
  | 'evidence_guidance'
  | 'safety_override'
  | 'meta_feedback';

export type ConversationTurnPolicyDecision = {
  responseStrategy: ConversationTurnResponseStrategy;
  ragRequired: boolean;
  ragReason:
    | 'not_required'
    | 'legal_lookup'
    | 'required_intent'
    | 'source_grounded_request';
  groundedAnswerRequired: boolean;
  questionAllowed: boolean;
  maxQuestions: number;
  disclaimerRequired: boolean;
  sourcesVisible: boolean;
  pathwayAllowed: boolean;
  timelineCollectionAllowed: boolean;
  humanReviewRequired: boolean;
  humanReviewRecommended: boolean;
  humanReviewReasons: string[];
  principleOrder: [
    'human_first',
    'triage_before_data_collection',
    'minimum_necessary_information',
    'understand_not_decide',
    'pathways_over_laws',
    'authoritative_rag_only'
  ];
};

const RAG_REQUIRED_INTENTS = new Set<string>([
  'legal_boundary_specific_case',
  'rag_pathway_question'
]);

const PRINCIPLE_ORDER: ConversationTurnPolicyDecision['principleOrder'] = [
  'human_first',
  'triage_before_data_collection',
  'minimum_necessary_information',
  'understand_not_decide',
  'pathways_over_laws',
  'authoritative_rag_only'
];

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const requiresGroundedFactualAnswer = (query: string): boolean => {
  const normalized = collapseWhitespace(query);
  const sourceConstrained =
    /\b(according to|aihw|uploaded\s+(?:document|report|source)|(?:this|the)\s+(?:document|report|source|guidance|guideline|act|legislation)|cite|citation|page\s+number|section\s+[0-9a-z]|national code|higher education guidance)\b/i.test(
      normalized
    );
  const factualRequest =
    /\b(what|which|when|where|who|how many|how much|percentage|percent|rate|number|date|define|definition|called|state|territor|compare|difference|does|did|is|are|was|were)\b/i.test(
      normalized
    );

  return sourceConstrained && (factualRequest || /\?/.test(normalized));
};

const needsSourceGroundedRetrieval = (message: string): boolean =>
  requiresGroundedFactualAnswer(message) || SOURCE_GROUNDED_TOPIC_PATTERN.test(message);

export const shouldUseRagForIntent = (input: {
  intent: string;
  message: string;
  responseMode: ConversationAssistantResponseMode | string;
}): boolean => buildConversationTurnPolicy(input).ragRequired;

export const buildConversationTurnPolicy = (input: {
  intent: string;
  message: string;
  responseMode: ConversationAssistantResponseMode | string;
}): ConversationTurnPolicyDecision => {
  const normalized = collapseWhitespace(input.message);
  const humanReviewReasons: string[] = [];

  let ragRequired = false;
  let ragReason: ConversationTurnPolicyDecision['ragReason'] = 'not_required';

  if (normalized) {
    if (input.responseMode === 'legal_lookup') {
      ragRequired = true;
      ragReason = 'legal_lookup';
    } else if (RAG_REQUIRED_INTENTS.has(input.intent)) {
      ragRequired = true;
      ragReason = 'required_intent';
    } else if (needsSourceGroundedRetrieval(normalized)) {
      ragRequired = true;
      ragReason = 'source_grounded_request';
    }
  }

  if (
    input.responseMode === 'legal_lookup' ||
    input.intent === 'legal_boundary_specific_case' ||
    HIGH_IMPACT_LEGAL_PATTERN.test(normalized)
  ) {
    humanReviewReasons.push('may_influence_legal_or_reporting_decision');
  }

  const groundedAnswerRequired =
    input.responseMode === 'legal_lookup' ||
    (ragRequired &&
      (ragReason === 'source_grounded_request' || ragReason === 'required_intent'));

  let responseStrategy: ConversationTurnPolicyDecision['responseStrategy'] = 'support_only';
  let questionAllowed = true;
  let maxQuestions = 1;
  let disclaimerRequired = false;
  let sourcesVisible = false;
  let pathwayAllowed = true;
  let timelineCollectionAllowed = false;

  if (input.responseMode === 'triage_handoff') {
    responseStrategy = 'triage_handoff';
    questionAllowed = false;
    maxQuestions = 0;
  } else if (input.responseMode === 'emergency_safety') {
    responseStrategy = 'safety_override';
    questionAllowed = false;
    maxQuestions = 0;
  } else if (input.responseMode === 'meta_feedback') {
    responseStrategy = 'meta_feedback';
    pathwayAllowed = false;
  } else if (input.responseMode === 'evidence_upload_intent') {
    responseStrategy = 'evidence_guidance';
    disclaimerRequired = true;
    timelineCollectionAllowed = true;
  } else if (input.responseMode === 'legal_lookup') {
    responseStrategy = 'grounded_legal_information';
    disclaimerRequired = true;
    sourcesVisible = true;
    timelineCollectionAllowed = true;
  } else if (groundedAnswerRequired) {
    responseStrategy = 'pathway_guidance';
    disclaimerRequired = true;
    sourcesVisible = true;
  } else if (input.responseMode === 'clarification_needed') {
    responseStrategy = 'support_only';
    pathwayAllowed = false;
    maxQuestions = 1;
  }

  const humanReviewRequired = input.responseMode === 'legal_lookup';

  return {
    responseStrategy,
    ragRequired,
    ragReason,
    groundedAnswerRequired,
    questionAllowed,
    maxQuestions,
    disclaimerRequired,
    sourcesVisible,
    pathwayAllowed,
    timelineCollectionAllowed,
    humanReviewRequired,
    humanReviewRecommended: humanReviewReasons.length > 0,
    humanReviewReasons,
    principleOrder: PRINCIPLE_ORDER
  };
};
