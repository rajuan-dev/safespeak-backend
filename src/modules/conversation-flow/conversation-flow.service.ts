import { StatusCodes } from 'http-status-codes';
import { Types, type HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';
import type { MicroEducationChip } from '@modules/microeducation/microeducation.types';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import { runTimelineAssistant } from '@modules/rag/rag.service';
import { SupportServiceModel } from '@modules/support/support.model';

import { CONVERSATION_FLOW_ACTIONS } from './conversation-flow.constants';
import {
  ConversationFlowFactsModel,
  ConversationFlowMessageModel,
  ConversationFlowSessionModel,
  ConversationFlowTriageModel,
  type ConversationFlowFactsDocument,
  type ConversationFlowSessionDocument
} from './conversation-flow.model';
import type {
  AppendConversationFlowMessageInput,
  CreateConversationFlowSessionInput
} from './conversation-flow.schema';
import type {
  ConversationFlowCategory,
  ConversationFlowContext,
  ConversationFlowRiskLevel
} from './conversation-flow.types';

type HydratedConversationFlowSessionDocument = HydratedDocument<ConversationFlowSessionDocument>;

const ownerFilter = (owner: ConversationFlowContext['owner']) => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const audit = async (
  context: ConversationFlowContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'session',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

const categoryDetectionRules: Array<{
  category: ConversationFlowCategory;
  keywords: RegExp[];
  selectedTopics?: string[];
  resourceTypes: string[];
}> = [
  {
    category: 'domestic_violence',
    keywords: [
      /\b(partner|husband|wife|boyfriend|girlfriend|ex partner|ex-partner)\b/i,
      /\b(domestic violence|family violence|family harm|controlling|coercive control)\b/i,
      /\b(he hit me|she hit me|hurt me at home|threatened me at home)\b/i
    ],
    selectedTopics: ['domestic_violence'],
    resourceTypes: [
      'emergency',
      'domestic_violence_agency',
      'mental_health',
      'safety_planning',
      'evidence_guidance',
      'council_support'
    ]
  },
  {
    category: 'workplace_bullying',
    keywords: [
      /\b(manager|supervisor|coworker|co-worker|colleague|hr|human resources|workplace)\b/i,
      /\b(bullying at work|workplace bullying|unsafe at work)\b/i,
      /\b(roster|shift|office|employer)\b/i
    ],
    resourceTypes: ['workplace_body', 'legal', 'mental_health', 'government', 'evidence_guidance']
  },
  {
    category: 'racism_discrimination',
    keywords: [
      /\b(racist|racism|racial abuse|racial slur|discrimination|hate speech|vilification)\b/i,
      /\b(because of my race|because i am muslim|because i am black|because of my skin)\b/i,
      /\b(hijab|hijub|headscarf|veil)\b/i
    ],
    selectedTopics: ['racial_abuse'],
    resourceTypes: [
      'police',
      'anti_discrimination_body',
      'government',
      'mental_health',
      'council_support',
      'evidence_guidance'
    ]
  },
  {
    category: 'online_abuse',
    keywords: [
      /\b(online abuse|cyberbullying|cyber bullying|image abuse|doxx|revenge porn|harassed online)\b/i,
      /\b(instagram|facebook|tiktok|snapchat|discord|email|dm|message me online)\b/i
    ],
    resourceTypes: [
      'online_safety',
      'police',
      'mental_health',
      'evidence_guidance',
      'safety_planning'
    ]
  },
  {
    category: 'scam_fraud',
    keywords: [
      /\b(scam|fraud|phishing|otp|one time code|one-time code|bank account|fake link)\b/i,
      /\b(stole my money|took my money|account hacked)\b/i
    ],
    selectedTopics: ['cyber_scam', 'scamshield'],
    resourceTypes: ['scam_support', 'government', 'police', 'online_safety', 'evidence_guidance']
  },
  {
    category: 'theft_property',
    keywords: [/\b(stole|stolen|theft|robbed|robbery|took my phone|took my bag|took my wallet)\b/i],
    resourceTypes: ['police', 'government', 'evidence_guidance', 'mental_health']
  },
  {
    category: 'harassment',
    keywords: [
      /\b(harassment|threatening me|stalking|followed me|intimidated)\b/i,
      /\b(grabbed|grab|pulled|pull|yanked|touched without permission)\b/i
    ],
    resourceTypes: ['police', 'legal', 'mental_health', 'evidence_guidance', 'safety_planning']
  },
  {
    category: 'mental_health_distress',
    keywords: [/\b(panic|anxious|anxiety|depressed|overwhelmed|can.t cope|mental health)\b/i],
    resourceTypes: ['mental_health', 'community', 'safety_planning']
  }
];

const selectedTopicFallbackCategory = (selectedTopic?: string): ConversationFlowCategory => {
  switch (selectedTopic) {
    case 'domestic_violence':
      return 'domestic_violence';
    case 'racial_abuse':
      return 'racism_discrimination';
    case 'cyber_scam':
    case 'scamshield':
      return 'scam_fraud';
    case 'migrant_challenges':
      return 'harassment';
    default:
      return 'general_support';
  }
};

const categoryToRagIncidentCategory = (
  category?: ConversationFlowCategory
): 'domestic_violence' | 'racial_abuse' | 'migrant_challenges' | 'cyber_scam' | undefined => {
  switch (category) {
    case 'domestic_violence':
      return 'domestic_violence';
    case 'racism_discrimination':
      return 'racial_abuse';
    case 'scam_fraud':
    case 'online_abuse':
      return 'cyber_scam';
    default:
      return undefined;
  }
};

const conversationCategoryToKnowledgeTopics: Record<ConversationFlowCategory, string[]> = {
  domestic_violence: ['dv', 'support', 'crisis'],
  workplace_bullying: ['workplace', 'support', 'discrimination'],
  racism_discrimination: ['racial_hatred', 'discrimination', 'support'],
  online_abuse: ['online_safety', 'evidence', 'support'],
  scam_fraud: ['scam', 'online_safety', 'support'],
  theft_property: ['evidence', 'support', 'other'],
  harassment: ['discrimination', 'support', 'evidence'],
  mental_health_distress: ['support', 'crisis', 'other'],
  general_support: ['support', 'other']
};

const categoryLabels: Record<ConversationFlowCategory, string> = {
  domestic_violence: 'Domestic violence',
  workplace_bullying: 'Workplace bullying',
  racism_discrimination: 'Racism or discrimination',
  online_abuse: 'Online abuse',
  scam_fraud: 'Scam or fraud',
  theft_property: 'Theft or property harm',
  harassment: 'Harassment',
  mental_health_distress: 'Mental health distress',
  general_support: 'General support'
};

const toSessionRecord = (session: ConversationFlowSessionDocument) => ({
  id: session._id.toString(),
  selectedTopic: session.selectedTopic,
  detectedCategory: session.detectedCategory,
  status: session.status,
  safetyRiskLevel: session.safetyRiskLevel,
  jurisdiction: session.jurisdiction,
  location: session.location,
  messageCount: session.messageCount,
  userTurnCount: session.userTurnCount,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
});

const toMessageRecord = (message: {
  _id: { toString: () => string };
  role: string;
  content: string;
  turnNumber: number;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) => ({
  id: message._id.toString(),
  role: message.role,
  content: message.content,
  turnNumber: message.turnNumber,
  metadata: message.metadata ?? {},
  createdAt: message.createdAt
});

const toSafeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return fallback;
};

const getRecordString = (
  record: Record<string, unknown>,
  key: string,
  fallback = ''
): string => toSafeString(record[key], fallback);

const toStringRecord = (record: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, toSafeString(value).trim()] as const)
      .filter(([, value]) => value)
  );

const toRecordArray = (items: unknown[]): Array<Record<string, unknown>> =>
  items.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item)
  );

const recommendationResourceType = (item: Record<string, unknown>): string =>
  getRecordString(item, 'resourceType');

const toAssistantConversationRole = (role: string): 'assistant' | 'user' =>
  role === 'assistant' ? 'assistant' : 'user';

const buildFactsFromTimeline = (
  conversationSessionId: string,
  timeline: Record<string, string>
): Omit<ConversationFlowFactsDocument, '_id' | 'createdAt' | 'updatedAt'> => {
  const whatHappened = timeline.what?.trim() || undefined;
  const whenHappened = timeline.when?.trim() || undefined;
  const whereHappened = timeline.where?.trim() || undefined;
  const peopleInvolved =
    [timeline.who, timeline.relationship].filter(Boolean).join(' - ') || undefined;
  const safetyConcerns =
    [timeline.unsafe_now, timeline.threats, timeline.injuries].filter(Boolean).join(' - ') ||
    undefined;
  const evidenceMentioned = timeline.evidence?.trim() || undefined;
  const emotionalState = timeline.impact?.trim() || undefined;
  const missingInformation = ['what', 'when', 'where', 'who']
    .filter((key) => !timeline[key]?.trim())
    .map((key) => `${key}_details`);
  const extractedEvents = [whatHappened, whenHappened, whereHappened, peopleInvolved]
    .filter(Boolean)
    .map((value) => toSafeString(value));

  return {
    conversationSessionId: new Types.ObjectId(conversationSessionId),
    whatHappened,
    whenHappened,
    whereHappened,
    peopleInvolved,
    safetyConcerns,
    evidenceMentioned,
    emotionalState,
    extractedEvents,
    missingInformation,
    timeline
  };
};

const buildFallbackAssistantResponse = (message: string, timeline: Record<string, string>) => {
  const lowerMessage = message.toLowerCase();
  const hasImmediateSafetySignal =
    /\b(immediate danger|unsafe now|kill me|suicide|self[- ]?harm|weapon|strangled|can.t breathe)\b/i.test(
      lowerMessage
    );
  const empatheticPrefix = hasImmediateSafetySignal
    ? 'I am sorry you are dealing with this. If you are in immediate danger, you can call 000 now.'
    : /(sorry|hurt|scared|afraid|threat|unsafe|panic|upset|cry|lonely|stressed|overwhelmed)/i.test(
          lowerMessage
        )
      ? 'I am sorry this is happening. You can take this one step at a time here.'
      : 'Thank you for sharing that. You do not need to explain everything at once.';

  let nextQuestion = 'What feels most important for me to understand next?';

  if (hasImmediateSafetySignal && !timeline.unsafe_now) {
    nextQuestion = 'Are you safe right now?';
  } else if (!timeline.what) {
    nextQuestion = 'Can you tell me a little more about what happened?';
  } else if (!timeline.when) {
    nextQuestion = 'Do you remember when this happened?';
  } else if (!timeline.where) {
    nextQuestion = 'Where did this happen?';
  } else if (!timeline.who) {
    nextQuestion = 'Who was involved?';
  } else if (!timeline.unsafe_now) {
    nextQuestion = 'Do you feel safe right now?';
  }

  return {
    assistantMessage: empatheticPrefix,
    nextQuestion,
    readyForSubmission: false,
    confidence: 'low' as const,
    disclaimer: 'This is information only, not legal advice.',
    citations: [],
    rag: {
      used: false,
      unavailable: true,
      resultCount: 0
    },
    reviewStatus: 'fallback_local'
  };
};

const detectCategory = (input: {
  text: string;
  selectedTopic?: string;
}): {
  category: ConversationFlowCategory;
  confidenceScore: number;
  matchedResourceTypes: string[];
} => {
  const matches = categoryDetectionRules
    .map((rule) => {
      let score = 0;

      for (const keyword of rule.keywords) {
        if (keyword.test(input.text)) {
          score += 1;
        }
      }

      if (rule.selectedTopics?.includes(input.selectedTopic ?? '')) {
        score += 0.75;
      }

      return {
        category: rule.category,
        score,
        matchedResourceTypes: rule.resourceTypes
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (matches.length === 0) {
    return {
      category: selectedTopicFallbackCategory(input.selectedTopic),
      confidenceScore: input.selectedTopic ? 0.45 : 0.25,
      matchedResourceTypes: ['government', 'mental_health', 'evidence_guidance']
    };
  }

  const best = matches[0];
  const confidenceScore = Math.min(0.95, 0.4 + best.score * 0.18);

  return {
    category: best.category,
    confidenceScore,
    matchedResourceTypes: best.matchedResourceTypes
  };
};

const detectSafetyRiskLevel = (
  text: string,
  facts: Partial<ConversationFlowFactsDocument>
): ConversationFlowRiskLevel => {
  const combined =
    `${text}\n${facts.safetyConcerns ?? ''}\n${facts.emotionalState ?? ''}`.toLowerCase();

  if (
    /\b(immediate danger|kill me|kill him|kill her|call 000|unsafe now|weapon|strangled|strangle|can.t breathe)\b/i.test(
      combined
    )
  ) {
    return 'immediate';
  }

  if (
    /\b(threat|hit|assault|injured|stalking|followed|scared to go home|afraid to go home)\b/i.test(
      combined
    )
  ) {
    return 'high';
  }

  if (/\b(anxious|overwhelmed|panic|distress|worried|harassed)\b/i.test(combined)) {
    return 'medium';
  }

  return 'low';
};

const shouldOfferTriage = (
  session: ConversationFlowSessionDocument,
  timeline: Record<string, string>
) => {
  const usefulTimelineFields = ['what', 'when', 'where', 'who', 'impact', 'evidence'].filter(
    (key) => timeline[key]?.trim()
  ).length;

  return session.userTurnCount >= 4 && (usefulTimelineFields >= 3 || session.messageCount >= 8);
};

const shouldBlockTriage = (triage: {
  likelyCategory: ConversationFlowCategory;
  confidenceScore: number;
  canProceedToRecommendations: boolean;
}) =>
  triage.likelyCategory === 'general_support' ||
  triage.confidenceScore < 0.45 ||
  !triage.canProceedToRecommendations;

const buildReasoningSummary = (input: {
  category: ConversationFlowCategory;
  riskLevel: ConversationFlowRiskLevel;
  facts: Partial<ConversationFlowFactsDocument>;
  missingInformation: string[];
}): string => {
  const categoryLabel = categoryLabels[input.category];
  const missingText =
    input.missingInformation.length > 0
      ? ` Some details are still missing, especially ${input.missingInformation
          .slice(0, 2)
          .map((item) => item.replace(/_/g, ' '))
          .join(' and ')}.`
      : '';
  const riskText =
    input.riskLevel === 'immediate'
      ? ' There may be an immediate safety concern.'
      : input.riskLevel === 'high'
        ? ' There are signs this may involve a high level of risk.'
        : '';

  return `Based on what you shared so far, this looks most like ${categoryLabel.toLowerCase()}.${riskText}${missingText}`.trim();
};

const toKnowledgeSourceSummary = (source: {
  _id: { toString: () => string };
  title: string;
  jurisdiction: string;
  sourceCategory: string;
  sourceType: string;
  url?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) => ({
  id: source._id.toString(),
  title: source.title,
  jurisdiction: source.jurisdiction,
  sourceCategory: source.sourceCategory,
  sourceType: source.sourceType,
  url: source.url,
  summary:
    (typeof source.metadata?.plainEnglishSummary === 'string' &&
      source.metadata.plainEnglishSummary) ||
    source.description ||
    'Approved knowledge source'
});

const matchKnowledgeSources = async (input: {
  category: ConversationFlowCategory;
  jurisdiction?: string;
  text: string;
}) => {
  const candidateTopics = conversationCategoryToKnowledgeTopics[input.category];
  const sources = await RagKnowledgeSourceModel.find({
    status: 'approved',
    legalReviewed: true,
    topic: { $in: candidateTopics },
    jurisdiction: {
      $in: [input.jurisdiction, 'AU', 'Cth', 'Global'].filter(Boolean)
    }
  })
    .sort({ updatedAt: -1 })
    .limit(8)
    .lean();

  const summaries = sources.map((source) => toKnowledgeSourceSummary(source));
  const legislationIds = sources
    .filter((source) => source.sourceCategory === 'official_legal_source')
    .map((source) => source._id.toString());

  return {
    matchedKnowledgeSources: summaries,
    matchedLegislationIds: legislationIds
  };
};

const buildRecommendationsFilter = (input: {
  category: ConversationFlowCategory;
  riskLevel: ConversationFlowRiskLevel;
  matchedResourceTypes: string[];
  jurisdiction?: string;
}) => ({
  isPublished: true,
  isActive: true,
  jurisdiction: { $in: [input.jurisdiction, 'AU', 'Cth', 'Global'].filter(Boolean) },
  issueTypes: { $in: [input.category, 'general_support'] },
  $or: [
    { resourceType: { $in: input.matchedResourceTypes } },
    { safetyRiskLevels: { $in: [input.riskLevel, 'all'] } }
  ]
});

const toRecommendationRecord = (
  item: Record<string, unknown> & { _id?: { toString: () => string } },
  category: ConversationFlowCategory
) => ({
  id: (item._id?.toString() ?? getRecordString(item, 'id')) || getRecordString(item, 'key'),
  title: getRecordString(item, 'name') || getRecordString(item, 'title'),
  description: getRecordString(item, 'description'),
  category,
  resourceType: getRecordString(item, 'resourceType'),
  ctaLabel: typeof item.ctaLabel === 'string' ? item.ctaLabel : 'View option',
  phone: typeof item.phone === 'string' ? item.phone : undefined,
  email: typeof item.email === 'string' ? item.email : undefined,
  websiteUrl: typeof item.websiteUrl === 'string' ? item.websiteUrl : undefined,
  priority:
    typeof item.priority === 'number'
      ? item.priority
      : typeof item.sortOrder === 'number'
        ? item.sortOrder
        : 0,
  jurisdiction: typeof item.jurisdiction === 'string' ? item.jurisdiction : undefined,
  safetyNotes: typeof item.safetyNotes === 'string' ? item.safetyNotes : undefined,
  eligibilityNotes: typeof item.eligibilityNotes === 'string' ? item.eligibilityNotes : undefined,
  languageSupportNotes:
    typeof item.languageSupportNotes === 'string' ? item.languageSupportNotes : undefined,
  active: typeof item.isActive === 'boolean' ? item.isActive : undefined
});

const violenceTerms = [
  'abuse',
  'assault',
  'bullying',
  'coercive',
  'domestic',
  'discrimination',
  'family violence',
  'harassment',
  'harm',
  'intimidation',
  'racial',
  'racial abuse',
  'racism',
  'sexual violence',
  'stalking',
  'threat',
  'violence',
  'workplace bullying'
];

type MicroEducationSuggestionProfile = {
  category: ConversationFlowCategory;
  safetyRiskLevel: ConversationFlowRiskLevel;
  preferredChips: MicroEducationChip[];
  keywords: string[];
  anchorPatterns: RegExp[];
  bridgePatterns: RegExp[];
  protectedPatterns: RegExp[];
  excludedPatterns: RegExp[];
  minimumScore: number;
};

const buildSupportSearchText = (triage: {
  likelyCategory: ConversationFlowCategory;
  reasoningSummary: string;
  matchedResourceTypes: string[];
  missingInformation: string[];
  matchedKnowledgeSources: Array<Record<string, unknown>>;
}) =>
  [
    triage.likelyCategory,
    categoryLabels[triage.likelyCategory],
    triage.reasoningSummary,
    ...triage.matchedResourceTypes,
    ...triage.missingInformation,
    ...triage.matchedKnowledgeSources.flatMap((source) => [
      source.title,
      source.summary,
      source.sourceCategory,
      source.sourceType
    ])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const reorderRiskFirst = (
  chips: MicroEducationChip[],
  safetyRiskLevel: ConversationFlowRiskLevel
): MicroEducationChip[] => {
  if (safetyRiskLevel !== 'high' && safetyRiskLevel !== 'immediate') {
    return chips;
  }

  const urgentOrder: MicroEducationChip[] = ['safety', 'mentalHealth', 'harassment', 'rights'];

  return urgentOrder.filter((chip) => chips.includes(chip));
};

const buildMicroEducationSuggestionProfile = (triage: {
  likelyCategory: ConversationFlowCategory;
  safetyRiskLevel: ConversationFlowRiskLevel;
  reasoningSummary: string;
  matchedResourceTypes: string[];
  missingInformation: string[];
  matchedKnowledgeSources: Array<Record<string, unknown>>;
}): MicroEducationSuggestionProfile | null => {
  const searchText = buildSupportSearchText(triage);
  const supportedCategory =
    triage.likelyCategory === 'domestic_violence' ||
    triage.likelyCategory === 'racism_discrimination' ||
    triage.likelyCategory === 'online_abuse' ||
    triage.likelyCategory === 'scam_fraud' ||
    triage.likelyCategory === 'workplace_bullying' ||
    triage.likelyCategory === 'mental_health_distress' ||
    triage.likelyCategory === 'theft_property' ||
    triage.likelyCategory === 'harassment';

  if (!supportedCategory && !violenceTerms.some((term) => searchText.includes(term))) {
    return null;
  }

  let preferredChips: MicroEducationChip[] = ['harassment', 'safety', 'rights', 'mentalHealth'];
  let keywords = ['abuse', 'bullying', 'harassment', 'threat', 'safety', 'violence'];
  let anchorPatterns: RegExp[] = [
    /\babuse\b/i,
    /\bviolence\b/i,
    /\bthreat/i,
    /\bharass/i
  ];
  let bridgePatterns: RegExp[] = [
    /\bevidence\b/i,
    /\bsupport\b/i,
    /\bright/i,
    /\bsafety plan/i,
    /\bsafety planning/i
  ];
  let protectedPatterns: RegExp[] = [
    /\blegal aid\b/i,
    /\bmental health\b/i,
    /\bcounsell?ing\b/i,
    /\bevidence\b/i,
    /\bsafety plan/i,
    /\bsafety planning/i
  ];
  let excludedPatterns: RegExp[] = [];
  let minimumScore = 18;

  if (triage.likelyCategory === 'domestic_violence') {
    preferredChips = ['safety', 'mentalHealth', 'harassment', 'rights'];
    keywords = ['domestic', 'family', 'violence', 'safety', 'mental', 'support'];
    anchorPatterns = [
      /\bdomestic\b/i,
      /\bfamily violence\b/i,
      /\bfamily harm\b/i,
      /\bpartner\b/i,
      /\bcoercive\b/i,
      /\babuse\b/i,
      /\bviolence\b/i,
      /\b1800respect\b/i
    ];
    bridgePatterns = [
      /\bsafety plan/i,
      /\bsafety planning/i,
      /\bunsafe\b/i,
      /\bthreat/i,
      /\bevidence\b/i,
      /\bsupport service\b/i,
      /\bconfidential support\b/i,
      /\bright/i
    ];
    protectedPatterns = [
      /\blegal aid\b/i,
      /\bmental health\b/i,
      /\bcounsell?ing\b/i,
      /\bcrisis\b/i,
      /\bevidence\b/i,
      /\bsafety plan/i,
      /\bsafety planning/i,
      /\b1800respect\b/i
    ];
    excludedPatterns = [
      /\bonline\b/i,
      /\bcyber\b/i,
      /\bdigital footprint\b/i,
      /\bbullying\b/i,
      /\bdiscrimination\b/i,
      /\bscam\b/i,
      /\bfraud\b/i,
      /\bworkplace\b/i
    ];
    minimumScore = 20;
  } else if (triage.likelyCategory === 'racism_discrimination') {
    preferredChips = ['harassment', 'rights', 'safety', 'mentalHealth'];
    keywords = ['racial', 'discrimination', 'rights', 'harassment', 'report'];
    anchorPatterns = [
      /\bracis[mt]\b/i,
      /\bracial\b/i,
      /\bdiscriminat/i,
      /\bhate\b/i,
      /\bvilification\b/i,
      /\bhijab\b/i
    ];
    excludedPatterns = [/\bdomestic\b/i, /\bscam\b/i, /\bfraud\b/i];
  } else if (triage.likelyCategory === 'online_abuse') {
    preferredChips = ['safety', 'harassment', 'rights', 'mentalHealth'];
    keywords = ['online', 'cyber', 'digital', 'privacy', 'abuse', 'safety'];
    anchorPatterns = [
      /\bonline\b/i,
      /\bcyber\b/i,
      /\bdigital\b/i,
      /\beSafety\b/i,
      /\bprivacy\b/i,
      /\bimage-based\b/i,
      /\bdoxx/i,
      /\baccount\b/i
    ];
    excludedPatterns = [/\bdomestic\b/i, /\bworkplace\b/i, /\bscam\b/i];
  } else if (triage.likelyCategory === 'scam_fraud') {
    preferredChips = ['safety', 'rights', 'mentalHealth'];
    keywords = ['scam', 'fraud', 'online', 'privacy', 'bank', 'safety'];
    anchorPatterns = [
      /\bscam\b/i,
      /\bfraud\b/i,
      /\bphishing\b/i,
      /\bbank\b/i,
      /\bpassword\b/i,
      /\botp\b/i,
      /\baccount\b/i
    ];
    bridgePatterns = [/\bevidence\b/i, /\bsupport\b/i, /\bonline safety\b/i, /\bprivacy\b/i];
    excludedPatterns = [/\bdomestic\b/i, /\bworkplace\b/i, /\bracial\b/i];
  } else if (triage.likelyCategory === 'workplace_bullying') {
    preferredChips = ['harassment', 'rights', 'safety', 'mentalHealth'];
    keywords = ['bullying', 'harassment', 'workplace', 'document', 'rights'];
    anchorPatterns = [
      /\bworkplace\b/i,
      /\bat work\b/i,
      /\bboss\b/i,
      /\bmanager\b/i,
      /\bemployer\b/i,
      /\bbully/i,
      /\bharass/i
    ];
    excludedPatterns = [/\bdomestic\b/i, /\bscam\b/i, /\bonline abuse\b/i];
  } else if (triage.likelyCategory === 'mental_health_distress') {
    preferredChips = ['mentalHealth', 'safety', 'rights'];
    keywords = ['mental', 'stress', 'support', 'grounding', 'safety'];
    anchorPatterns = [
      /\bmental health\b/i,
      /\bstress/i,
      /\banxiety\b/i,
      /\blonely\b/i,
      /\bgrounding\b/i,
      /\bcounsell?ing\b/i,
      /\bsupport\b/i
    ];
    bridgePatterns = [/\bsafety\b/i, /\bsupport\b/i, /\bwellbeing\b/i];
    protectedPatterns = [/\bmental health\b/i, /\bcounsell?ing\b/i, /\bcrisis\b/i];
    excludedPatterns = [
      /\bdomestic\b/i,
      /\bscam\b/i,
      /\bfraud\b/i,
      /\bdiscrimination\b/i,
      /\bbullying\b/i
    ];
  } else if (triage.likelyCategory === 'theft_property') {
    preferredChips = ['safety', 'rights', 'mentalHealth'];
    keywords = ['theft', 'stolen', 'evidence', 'safety', 'rights'];
    anchorPatterns = [/\btheft\b/i, /\bstolen\b/i, /\brobbed\b/i, /\bproperty\b/i];
    bridgePatterns = [/\bevidence\b/i, /\bpolice\b/i, /\bright/i, /\bsafety\b/i];
  } else if (triage.likelyCategory === 'harassment') {
    preferredChips = ['harassment', 'safety', 'rights', 'mentalHealth'];
    keywords = ['harassment', 'threat', 'safety', 'document', 'rights'];
    anchorPatterns = [/\bharass/i, /\bthreat/i, /\bstalk/i, /\bintimidat/i];
    bridgePatterns = [/\bevidence\b/i, /\bright/i, /\bsafety plan/i, /\bsupport\b/i];
  }

  return {
    category: triage.likelyCategory,
    safetyRiskLevel: triage.safetyRiskLevel,
    preferredChips: reorderRiskFirst(preferredChips, triage.safetyRiskLevel),
    keywords,
    anchorPatterns,
    bridgePatterns,
    protectedPatterns,
    excludedPatterns,
    minimumScore
  };
};

const buildMicroCardSearchText = (card: {
  title?: string;
  tag?: string;
  summary?: string;
  detailHeading?: string;
  detailSummary?: string;
  detailBody?: string;
  detailTakeaway?: string;
  chips?: MicroEducationChip[];
}) =>
  [
    card.title,
    card.tag,
    card.summary,
    card.detailHeading,
    card.detailSummary,
    card.detailBody,
    card.detailTakeaway,
    ...(card.chips ?? [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const hasAnyPattern = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const isPlaceholderMicroCard = (card: {
  title?: string;
  tag?: string;
  summary?: string;
  detailHeading?: string;
  detailSummary?: string;
  detailBody?: string;
  detailTakeaway?: string;
  chips?: MicroEducationChip[];
}): boolean =>
  /\b(test|testing|sample|dummy|placeholder|lorem|new educational content|new description|create educational content)\b/i.test(
    buildMicroCardSearchText(card)
  );

const isMicroCardEligibleForProfile = (
  card: {
    title?: string;
    tag?: string;
    summary?: string;
    detailHeading?: string;
    detailSummary?: string;
    detailBody?: string;
    detailTakeaway?: string;
    chips?: MicroEducationChip[];
  },
  profile: MicroEducationSuggestionProfile
): boolean => {
  if (isPlaceholderMicroCard(card)) {
    return false;
  }

  const searchText = buildMicroCardSearchText(card);
  const hasAnchor = hasAnyPattern(searchText, profile.anchorPatterns);
  const hasBridge = hasAnyPattern(searchText, profile.bridgePatterns);
  const hasProtectedTopic = hasAnyPattern(searchText, profile.protectedPatterns);
  const hasExcludedTopic = hasAnyPattern(searchText, profile.excludedPatterns);

  if (hasExcludedTopic && !hasAnchor && !hasProtectedTopic) {
    return false;
  }

  return hasAnchor || hasBridge || hasProtectedTopic;
};

const scoreMicroCardForProfile = (
  card: {
    title?: string;
    tag?: string;
    summary?: string;
    detailHeading?: string;
    detailSummary?: string;
    detailBody?: string;
    detailTakeaway?: string;
    chips?: MicroEducationChip[];
  },
  profile: MicroEducationSuggestionProfile
) => {
  if (!isMicroCardEligibleForProfile(card, profile)) {
    return 0;
  }

  const searchText = buildMicroCardSearchText(card);
  let score = 0;

  (card.chips ?? []).forEach((chip) => {
    const chipIndex = profile.preferredChips.indexOf(chip);

    if (chipIndex >= 0) {
      score += (profile.preferredChips.length - chipIndex) * 12;
    }
  });

  profile.keywords.forEach((keyword) => {
    if (searchText.includes(keyword)) {
      score += 8;
    }
  });

  profile.anchorPatterns.forEach((pattern) => {
    if (pattern.test(searchText)) {
      score += 18;
    }
  });

  profile.bridgePatterns.forEach((pattern) => {
    if (pattern.test(searchText)) {
      score += 8;
    }
  });

  profile.protectedPatterns.forEach((pattern) => {
    if (pattern.test(searchText)) {
      score += 10;
    }
  });

  if (
    (profile.safetyRiskLevel === 'high' || profile.safetyRiskLevel === 'immediate') &&
    card.chips?.includes('safety')
  ) {
    score += 18;
  }

  if (
    (profile.safetyRiskLevel === 'high' || profile.safetyRiskLevel === 'immediate') &&
    card.chips?.includes('mentalHealth')
  ) {
    score += 10;
  }

  return score;
};

const getSuggestedMicroCardIds = async (triage: {
  likelyCategory: ConversationFlowCategory;
  safetyRiskLevel: ConversationFlowRiskLevel;
  reasoningSummary: string;
  matchedResourceTypes: string[];
  missingInformation: string[];
  matchedKnowledgeSources: Array<Record<string, unknown>>;
}) => {
  const profile = buildMicroEducationSuggestionProfile(triage);

  if (!profile) {
    return [];
  }

  const cards = await MicroEducationModel.find({
    status: 'published',
    deletedAt: { $exists: false }
  })
    .select(
      'title tag summary detailHeading detailSummary detailBody detailTakeaway chips sortOrder'
    )
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return cards
    .map((card) => ({
      id: card._id.toString(),
      sortOrder: card.sortOrder,
      score: scoreMicroCardForProfile(
        {
          title: card.title,
          tag: card.tag,
          summary: card.summary,
          detailHeading: card.detailHeading,
          detailSummary: card.detailSummary,
          detailBody: card.detailBody,
          detailTakeaway: card.detailTakeaway,
          chips: card.chips
        },
        profile
      )
    }))
    .filter((item) => item.score >= profile.minimumScore)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.sortOrder - right.sortOrder;
    })
    .map((item) => item.id)
    .slice(0, 8);
};

const toSupportAction = (
  slot: 'immediateDanger' | 'esafety' | 'counselling',
  recommendation?: ReturnType<typeof toRecommendationRecord>
) => ({
  slot,
  serviceId: recommendation?.id,
  resourceType: recommendation?.resourceType,
  ctaLabel: recommendation?.ctaLabel,
  phone: recommendation?.phone,
  websiteUrl: recommendation?.websiteUrl
});

const buildDetailSections = (input: {
  triage: {
    likelyCategory: ConversationFlowCategory;
    safetyRiskLevel: ConversationFlowRiskLevel;
    reasoningSummary: string;
    matchedKnowledgeSources: Array<Record<string, unknown>>;
  };
  recommendations: Array<Record<string, unknown>>;
  facts: Partial<ConversationFlowFactsDocument>;
}) => {
  const reportingOptions = input.recommendations.filter((item) =>
    ['emergency', 'police', 'government', 'workplace_body', 'anti_discrimination_body'].includes(
      recommendationResourceType(item)
    )
  );
  const supportServices = input.recommendations.filter((item) =>
    ['mental_health', 'domestic_violence_agency', 'council_support', 'legal'].includes(
      recommendationResourceType(item)
    )
  );
  const evidenceGuide = input.recommendations.filter((item) =>
    ['evidence_guidance'].includes(recommendationResourceType(item))
  );
  const safetyPlanning = input.recommendations.filter((item) =>
    ['safety_planning', 'emergency'].includes(recommendationResourceType(item))
  );

  return {
    overview: {
      title: 'Overview',
      body: input.triage.reasoningSummary
    },
    rights: {
      title: 'Your Rights',
      items: input.triage.matchedKnowledgeSources.map((source) => ({
        title: getRecordString(source, 'title', 'Source'),
        body: getRecordString(source, 'summary', 'Approved information source')
      }))
    },
    reportingOptions: {
      title: 'Reporting Options',
      items: reportingOptions
    },
    evidenceGuide: {
      title: 'Evidence Guide',
      items:
        evidenceGuide.length > 0
          ? evidenceGuide
          : [
              {
                title: 'Evidence tips',
                description:
                  'If it feels safe, keep screenshots, dates, locations, names, messages, and any photos or notes that help describe what happened.'
              }
            ]
    },
    supportServices: {
      title: 'Support Services',
      items: supportServices
    },
    safetyPlanning: {
      title: 'Safety Planning',
      items:
        safetyPlanning.length > 0
          ? safetyPlanning
          : [
              {
                title: 'Safety planning',
                description:
                  input.triage.safetyRiskLevel === 'immediate'
                    ? 'If you are in immediate danger, call 000 now.'
                    : 'Think about where you can go, who you can contact, and what evidence or belongings you may need to keep safe.'
              }
            ]
    }
  };
};

const getOwnedConversationSession = async (
  context: ConversationFlowContext,
  sessionId: string
): Promise<HydratedConversationFlowSessionDocument> => {
  const session = await ConversationFlowSessionModel.findOne({
    _id: sessionId,
    ...ownerFilter(context.owner)
  });

  if (!session) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Conversation session not found');
  }

  return session;
};

const upsertFacts = async (conversationSessionId: string, timeline: Record<string, string>) => {
  const factPayload = buildFactsFromTimeline(conversationSessionId, timeline);

  return ConversationFlowFactsModel.findOneAndUpdate(
    { conversationSessionId },
    { $set: factPayload },
    { new: true, upsert: true }
  );
};

const buildTriageForSession = async (session: HydratedConversationFlowSessionDocument) => {
  const messages = await ConversationFlowMessageModel.find({
    conversationSessionId: session._id
  })
    .sort({ turnNumber: 1 })
    .lean();
  const facts = await ConversationFlowFactsModel.findOne({
    conversationSessionId: session._id
  }).lean();
  const combinedText = messages.map((message) => message.content).join('\n');
  const categoryDetection = detectCategory({
    text: `${combinedText}\n${JSON.stringify(facts?.timeline ?? {})}`,
    selectedTopic: session.selectedTopic
  });
  const riskLevel = detectSafetyRiskLevel(combinedText, facts ?? {});
  const missingInformation = facts?.missingInformation ?? [
    'what_details',
    'when_details',
    'where_details'
  ];
  const knowledgeMatch = await matchKnowledgeSources({
    category: categoryDetection.category,
    jurisdiction: session.jurisdiction,
    text: combinedText
  });
  const canProceedToRecommendations =
    categoryDetection.confidenceScore >= 0.45 &&
    Boolean(facts?.whatHappened) &&
    Boolean(facts?.peopleInvolved || facts?.whereHappened || facts?.whenHappened);
  const humanReviewRecommended =
    !canProceedToRecommendations ||
    knowledgeMatch.matchedLegislationIds.length === 0 ||
    categoryDetection.confidenceScore < 0.6;
  const reasoningSummary = buildReasoningSummary({
    category: categoryDetection.category,
    riskLevel,
    facts: facts ?? {},
    missingInformation
  });

  const triage = await ConversationFlowTriageModel.findOneAndUpdate(
    { conversationSessionId: session._id },
    {
      $set: {
        likelyCategory: categoryDetection.category,
        confidenceScore: Number(categoryDetection.confidenceScore.toFixed(2)),
        safetyRiskLevel: riskLevel,
        reasoningSummary,
        matchedLegislationIds: knowledgeMatch.matchedLegislationIds,
        matchedKnowledgeSources: knowledgeMatch.matchedKnowledgeSources,
        humanReviewRecommended,
        missingInformation,
        canProceedToRecommendations,
        matchedResourceTypes: categoryDetection.matchedResourceTypes
      }
    },
    { new: true, upsert: true }
  ).lean();

  session.detectedCategory = triage.likelyCategory;
  session.safetyRiskLevel = triage.safetyRiskLevel;
  session.status = canProceedToRecommendations
    ? 'triaged'
    : session.status === 'active'
      ? 'ready_for_triage'
      : session.status;
  await session.save();

  return triage;
};

export const createConversationFlowSession = async (
  context: ConversationFlowContext,
  input: CreateConversationFlowSessionInput
) => {
  const session = await ConversationFlowSessionModel.create({
    ...ownerFilter(context.owner),
    selectedTopic: input.selectedTopic,
    jurisdiction: input.jurisdiction,
    location: input.location,
    status: 'active',
    safetyRiskLevel: 'low',
    messageCount: 0,
    userTurnCount: 0
  });

  await audit(context, CONVERSATION_FLOW_ACTIONS.sessionCreate, session._id.toString(), {
    selectedTopic: input.selectedTopic,
    jurisdiction: input.jurisdiction
  });

  return {
    session: toSessionRecord(session)
  };
};

export const getConversationFlowSession = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const messages = await ConversationFlowMessageModel.find({
    conversationSessionId: session._id
  })
    .sort({ turnNumber: 1 })
    .lean();
  const facts = await ConversationFlowFactsModel.findOne({
    conversationSessionId: session._id
  }).lean();
  const triage = await ConversationFlowTriageModel.findOne({
    conversationSessionId: session._id
  }).lean();

  await audit(context, CONVERSATION_FLOW_ACTIONS.sessionGet, conversationSessionId);

  return {
    session: toSessionRecord(session),
    messages: messages.map((message) => toMessageRecord(message)),
    factExtraction: facts ?? null,
    triage: triage ?? null
  };
};

export const appendConversationFlowMessage = async (
  context: ConversationFlowContext,
  conversationSessionId: string,
  input: AppendConversationFlowMessageInput
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const existingMessages = await ConversationFlowMessageModel.find({
    conversationSessionId: session._id
  })
    .sort({ turnNumber: 1 })
    .lean();
  const userMessage = await ConversationFlowMessageModel.create({
    conversationSessionId: session._id,
    role: 'user',
    content: input.content,
    turnNumber: existingMessages.length + 1,
    metadata: {}
  });

  session.messageCount += 1;
  session.userTurnCount += 1;

  const conversationForAssistant = [
    ...existingMessages.map((message) => ({
      role: toAssistantConversationRole(message.role),
      content: message.content
    })),
    {
      role: 'user' as const,
      content: input.content
    }
  ];
  const existingFacts = await ConversationFlowFactsModel.findOne({
    conversationSessionId: session._id
  }).lean();
  const existingTimeline = (existingFacts?.timeline ?? {}) as Record<string, string>;
  const detectedCategory = detectCategory({
    text: `${input.content}\n${JSON.stringify(existingTimeline)}`,
    selectedTopic: session.selectedTopic
  }).category;

  let assistantPayload: Record<string, unknown>;

  try {
    assistantPayload = await runTimelineAssistant(
      {
        owner: context.owner,
        ip: context.ip,
        userAgent: context.userAgent
      },
      {
        message: input.content,
        topK: 4,
        conversation: conversationForAssistant,
        timeline: existingTimeline,
        language: input.language,
        incidentCategory: categoryToRagIncidentCategory(detectedCategory),
        jurisdiction: session.jurisdiction as
          | 'Cth'
          | 'NSW'
          | 'VIC'
          | 'QLD'
          | 'SA'
          | 'WA'
          | 'TAS'
          | 'NT'
          | 'ACT'
          | 'AU'
          | 'Global'
          | 'Internal'
          | undefined
      }
    );
  } catch {
    assistantPayload = buildFallbackAssistantResponse(input.content, existingTimeline);
  }

  const assistantMessageContent = [
    typeof assistantPayload.assistantMessage === 'string'
      ? assistantPayload.assistantMessage.trim()
      : '',
    typeof assistantPayload.nextQuestion === 'string' ? assistantPayload.nextQuestion.trim() : ''
  ]
    .filter(Boolean)
    .join(' ');
  const assistantMessage = await ConversationFlowMessageModel.create({
    conversationSessionId: session._id,
    role: 'assistant',
    content: assistantMessageContent || 'Thank you. What would feel helpful to share next?',
    turnNumber: existingMessages.length + 2,
    metadata: {
      confidence: assistantPayload.confidence,
      reviewStatus: assistantPayload.reviewStatus
    }
  });

  session.messageCount += 1;

  const nextTimeline =
    assistantPayload.timeline &&
    typeof assistantPayload.timeline === 'object' &&
    !Array.isArray(assistantPayload.timeline)
      ? (assistantPayload.timeline as Record<string, unknown>)
      : existingTimeline;
  const normalizedTimeline = toStringRecord(nextTimeline);
  const facts = await upsertFacts(session._id.toString(), normalizedTimeline);
  const enoughConversationForTriage = shouldOfferTriage(session, normalizedTimeline);
  const triage = enoughConversationForTriage ? await buildTriageForSession(session) : null;
  const offerTriage = Boolean(triage && !shouldBlockTriage(triage));

  if (offerTriage && !session.triageOfferedAt) {
    session.triageOfferedAt = new Date();
    session.status = 'ready_for_triage';
  } else if (enoughConversationForTriage && triage) {
    session.status = 'ready_for_triage';
  } else if (session.status === 'active') {
    session.status = 'active';
  }

  await session.save();

  await audit(context, CONVERSATION_FLOW_ACTIONS.messageAppend, conversationSessionId, {
    offeredTriage: offerTriage,
    detectedCategory: triage?.likelyCategory ?? detectedCategory
  });

  return {
    session: toSessionRecord(session),
    userMessage: toMessageRecord(userMessage),
    assistantMessage: toMessageRecord(assistantMessage),
    factExtraction: facts,
    triage,
    transition: {
      offerTriage,
      prompt: offerTriage
        ? 'I am sorry this happened to you. You are safe to explore your options here. Would you like help understanding reporting options, support services, evidence, or your rights?'
        : enoughConversationForTriage
          ? 'Based on what you shared so far, this does not appear to fit the harm, safety, scam, violence, harassment, or discrimination categories that move to triage here. You can keep chatting if there is more context.'
          : null,
      primaryCta: offerTriage ? 'Continue to Triage' : null,
      secondaryCta: offerTriage ? 'Review my options' : null
    },
    responseMeta: {
      confidence: assistantPayload.confidence ?? 'low',
      disclaimer: 'This is information only, not legal advice.',
      citations: Array.isArray(assistantPayload.citations) ? assistantPayload.citations : [],
      rag: assistantPayload.rag ?? {
        used: false,
        unavailable: true,
        resultCount: 0
      },
      reviewStatus: assistantPayload.reviewStatus ?? 'fallback_local'
    }
  };
};

export const getConversationFlowTriage = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const triage = await buildTriageForSession(session);

  await audit(context, CONVERSATION_FLOW_ACTIONS.triageGet, conversationSessionId, {
    likelyCategory: triage.likelyCategory
  });

  return {
    session: toSessionRecord(session),
    triage: {
      ...triage,
      likelyCategoryLabel: categoryLabels[triage.likelyCategory],
      confidenceLabel:
        triage.confidenceScore >= 0.75 ? 'high' : triage.confidenceScore >= 0.5 ? 'medium' : 'low',
      disclaimer: 'This is information only, not legal advice.'
    }
  };
};

export const getConversationFlowSupport = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const triage = await buildTriageForSession(session);
  const recommendationDocs = await SupportServiceModel.find(
    buildRecommendationsFilter({
      category: triage.likelyCategory,
      riskLevel: triage.safetyRiskLevel,
      matchedResourceTypes: triage.matchedResourceTypes,
      jurisdiction: session.jurisdiction
    })
  )
    .sort({ priority: -1, sortOrder: 1, name: 1 })
    .limit(8)
    .lean();
  const recommendations = recommendationDocs.map((item) =>
    toRecommendationRecord(
      item as Record<string, unknown> & { _id?: { toString: () => string } },
      triage.likelyCategory
    )
  );
  const emergencyRecommendation = recommendations.find((item) =>
    ['emergency', 'police'].includes(item.resourceType)
  );
  const esafetyRecommendation = recommendations.find(
    (item) => item.resourceType === 'online_safety' || /esafety/i.test(item.title)
  );
  const counsellingRecommendation = recommendations.find(
    (item) =>
      ['mental_health', 'domestic_violence_agency'].includes(item.resourceType) ||
      /counsell?ing|lifeline|1800respect/i.test(item.title)
  );
  const suggestedMicroCardIds = await getSuggestedMicroCardIds({
    likelyCategory: triage.likelyCategory,
    safetyRiskLevel: triage.safetyRiskLevel,
    reasoningSummary: triage.reasoningSummary,
    matchedResourceTypes: triage.matchedResourceTypes,
    missingInformation: triage.missingInformation,
    matchedKnowledgeSources: toRecordArray(triage.matchedKnowledgeSources)
  });

  await audit(context, CONVERSATION_FLOW_ACTIONS.supportGet, conversationSessionId, {
    likelyCategory: triage.likelyCategory,
    suggestedMicroCardCount: suggestedMicroCardIds.length,
    recommendationCount: recommendations.length
  });

  return {
    session: toSessionRecord(session),
    triage: {
      ...triage,
      likelyCategoryLabel: categoryLabels[triage.likelyCategory],
      confidenceLabel:
        triage.confidenceScore >= 0.75 ? 'high' : triage.confidenceScore >= 0.5 ? 'medium' : 'low',
      disclaimer: 'This is information only, not legal advice.'
    },
    support: {
      suggestedMicroCardIds,
      recommendedActions: [
        toSupportAction('immediateDanger', emergencyRecommendation),
        toSupportAction('esafety', esafetyRecommendation),
        toSupportAction('counselling', counsellingRecommendation)
      ],
      additionalResources: [
        toSupportAction('esafety', esafetyRecommendation),
        toSupportAction('counselling', counsellingRecommendation)
      ],
      matchedSupportServices: recommendations,
      fallbackUsed: recommendations.length === 0
    }
  };
};

export const getConversationFlowRecommendations = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const triageRecord =
    (await ConversationFlowTriageModel.findOne({
      conversationSessionId: session._id
    }).lean()) ?? (await buildTriageForSession(session));
  const recommendations = await SupportServiceModel.find(
    buildRecommendationsFilter({
      category: triageRecord.likelyCategory,
      riskLevel: triageRecord.safetyRiskLevel,
      matchedResourceTypes: triageRecord.matchedResourceTypes,
      jurisdiction: session.jurisdiction
    })
  )
    .sort({ priority: -1, sortOrder: 1, name: 1 })
    .limit(8)
    .lean();

  session.status = triageRecord.canProceedToRecommendations
    ? 'recommendation_ready'
    : session.status;
  await session.save();

  await audit(context, CONVERSATION_FLOW_ACTIONS.recommendationsGet, conversationSessionId, {
    count: recommendations.length
  });

  return {
    session: toSessionRecord(session),
    recommendations: recommendations.map((item) =>
      toRecommendationRecord(
        item as Record<string, unknown> & { _id?: { toString: () => string } },
        triageRecord.likelyCategory
      )
    ),
    fallbackUsed: recommendations.length === 0
  };
};

export const getConversationFlowDetails = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const triageRecord =
    (await ConversationFlowTriageModel.findOne({
      conversationSessionId: session._id
    }).lean()) ?? (await buildTriageForSession(session));
  const facts = await ConversationFlowFactsModel.findOne({
    conversationSessionId: session._id
  }).lean();
  const recommendationsResponse = await getConversationFlowRecommendations(
    context,
    conversationSessionId
  );
  const sections = buildDetailSections({
    triage: triageRecord,
    recommendations: recommendationsResponse.recommendations,
    facts: facts ?? {}
  });

  await audit(context, CONVERSATION_FLOW_ACTIONS.detailsGet, conversationSessionId);

  return {
    session: toSessionRecord(session),
    details: {
      category: triageRecord.likelyCategory,
      categoryLabel: categoryLabels[triageRecord.likelyCategory],
      safetyRiskLevel: triageRecord.safetyRiskLevel,
      matchedKnowledgeSources: triageRecord.matchedKnowledgeSources,
      matchedLegislationIds: triageRecord.matchedLegislationIds,
      humanReviewRecommended: triageRecord.humanReviewRecommended,
      sections,
      disclaimer: 'This is information only, not legal advice.'
    }
  };
};
