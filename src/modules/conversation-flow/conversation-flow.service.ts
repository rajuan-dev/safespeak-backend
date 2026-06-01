import { StatusCodes } from 'http-status-codes';
import { Types, type HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import {
  buildAssistantSourceDisplayMeta,
  runTimelineAssistant
} from '@modules/rag/rag.service';
import { SupportServiceModel } from '@modules/support/support.model';

import { CONVERSATION_FLOW_ACTIONS, CONVERSATION_FLOW_CATEGORIES } from './conversation-flow.constants';
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

const ACTIONABLE_TRIAGE_CONFIDENCE_THRESHOLD = 0.45;

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
      /\b(he hit me|she hit me|hurt me at home|threatened me at home)\b/i,
      /\b(threatened|threats?|shoot|shot|gun|weapon|find me|come back|things will get worse)\b/i
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
      /\b(manager|supervisor|coworker|co-worker|colleague|hr|human resources|workplace)\b.*\b(bully|harass|humiliat|pressure|unsafe)\b/i,
      /\b(bullying at work|workplace bullying|unsafe at work)\b/i,
      /\b(employer|office|roster|shift)\b.*\b(bully|harass|humiliat|pressure)\b/i
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
      /\b(online abuse|cyberbullying|cyber bullying|image abuse|doxx|revenge porn|harassed online|private photos?|image-based abuse|threat(?:ened)? to publish|publish private messages?|share private messages?|data breach|privacy breach)\b/i,
      /\b(instagram|facebook|tiktok|snapchat|discord|email|dm|message me online|whatsapp|text message)\b/i
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
      /\b(scam|fraud|phishing|otp|one time code|one-time code|bank account|bank details?|fake link|identity theft|account details?)\b/i,
      /\b(stole my money|took my money|account hacked|stole my id|stole my identity)\b/i
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

type ConversationFlowStructuredFacts = {
  privacyDataBreach: boolean;
  identityTheftRisk: boolean;
  scamFraud: boolean;
  imageBasedAbuse: boolean;
  onlineThreatBlackmail: boolean;
  employerHealthPrivacy: boolean;
  workplaceBullying: boolean;
  workplaceContext: boolean;
  racismDiscrimination: boolean;
  domesticViolence: boolean;
  physicalViolence: boolean;
  threatsPresent: boolean;
  immediateDanger: boolean;
  evidenceAvailable: boolean;
  domesticFamilyContext: boolean;
  coerciveControl: boolean;
  blackmailOrExtortion: boolean;
  privatePhotosOrMessages: boolean;
  personalDataLeak: boolean;
  companyOrOrganisationInvolved: boolean;
  employerInvolved: boolean;
  healthInformation: boolean;
  identityDocumentsExposed: boolean;
  bankDetailsExposed: boolean;
  moneyLost: boolean;
  protectedAttribute: boolean;
  schoolContext: boolean;
  workplaceDiscrimination: boolean;
  housingOrServiceContext: boolean;
  elderOrVulnerablePerson: boolean;
  migrationOrVisaThreat: boolean;
  languageOrInterpreterNeed: boolean;
  selfHarmOrSuicidal: boolean;
  matchedFacts: string[];
  organisations: string[];
  platforms: string[];
  protectedAttributes: string[];
  jurisdiction?: string;
};

type ConversationFlowTriagePresentationRecord = {
  title: string;
  body: string;
  assessmentNote: string;
  primaryStepTitle: string;
  primaryStepBody: string;
  immediateDangerBody: string;
  secondTitle: string;
  secondBody: string;
  secondActionLabel: string;
  secondActionHref: string;
  thirdTitle: string;
  thirdBody: string;
  thirdActionLabel: string;
  thirdActionHref: string;
  stepReasons: string[];
  microCardSummary: string;
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const TRIAGE_HANDOFF_MESSAGE = 'Of course — I can take you to your triage summary now.';
const TRIAGE_HANDOFF_PHRASES = [
  'give me the triage button',
  'give me the trige button',
  'show me the triage button',
  'show me the trige button',
  'give me the triage page',
  'give me the trige page',
  'show my triage',
  'show my trige',
  'go to triage',
  'go to trige',
  'continue to triage',
  'continue to trige',
  'take me to triage',
  'take me to trige',
  'show recommended steps',
  'show next steps',
  'continue to next steps',
  'triage summary',
  'support summary'
] as const;

const normalizeConversationIntentText = (value: string): string =>
  collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const detectTriageHandoffIntent = (message: string): boolean => {
  const normalizedMessage = normalizeConversationIntentText(message);

  if (TRIAGE_HANDOFF_PHRASES.some((phrase) =>
    normalizedMessage.includes(normalizeConversationIntentText(phrase))
  )) {
    return true;
  }

  const triageSignals = [
    /\btriage\b/i,
    /\btrige\b/i,
    /\bnext steps\b/i,
    /\brecommended steps\b/i,
    /\bsupport summary\b/i
  ];

  return (
    triageSignals.some((pattern) => pattern.test(normalizedMessage)) &&
    /\b(page|button|go|take|continue|show|summary|steps?|give)\b/i.test(normalizedMessage)
  );
};

const buildTriageHandoffAssistantPayload = () => ({
  assistantMessage: TRIAGE_HANDOFF_MESSAGE,
  nextQuestion: '',
  readyForSubmission: false,
  confidence: 'medium' as const,
  disclaimer: 'This is information only, not legal advice.',
  citations: [],
  showSources: false,
  sourceDisplayReason: 'triage_handoff',
  triageReady: true,
  nextAction: 'show_triage_button',
  rag: {
    used: false,
    unavailable: false,
    resultCount: 0
  },
  reviewStatus: 'triage_handoff'
});

export const buildConversationAssistantResponseMeta = (input: {
  assistantPayload: Record<string, unknown>;
  conversationSessionId: string;
  offerTriage: boolean;
}) => {
  const citations = Array.isArray(input.assistantPayload.citations)
    ? input.assistantPayload.citations
    : [];
  const triageReady =
    Boolean(input.assistantPayload.triageReady) ||
    input.assistantPayload.nextAction === 'show_triage_button' ||
    input.offerTriage;
  const sourceDisplayMeta = buildAssistantSourceDisplayMeta({
    message:
      typeof input.assistantPayload.assistantMessage === 'string'
        ? input.assistantPayload.assistantMessage
        : '',
    citations: citations.map((citation) => {
      if (!citation || typeof citation !== 'object') {
        return {};
      }

      const safeCitation = citation as Record<string, unknown>;

      return {
        title:
          typeof safeCitation.title === 'string'
            ? safeCitation.title
            : undefined,
        sectionRef:
          typeof safeCitation.sectionRef === 'string'
            ? safeCitation.sectionRef
            : undefined,
        url: typeof safeCitation.url === 'string' ? safeCitation.url : undefined
      };
    }),
    triageHandoff: input.assistantPayload.sourceDisplayReason === 'triage_handoff'
  });

  return {
    confidence: input.assistantPayload.confidence ?? 'low',
    disclaimer: 'This is information only, not legal advice.',
    citations,
    rag:
      input.assistantPayload.rag ?? {
        used: false,
        unavailable: true,
        resultCount: 0
      },
    reviewStatus: input.assistantPayload.reviewStatus ?? 'fallback_local',
    triageReady,
    nextAction:
      typeof input.assistantPayload.nextAction === 'string'
        ? input.assistantPayload.nextAction
        : triageReady
          ? 'show_triage_button'
          : undefined,
    conversationSessionId: input.conversationSessionId,
    showSources:
      typeof input.assistantPayload.showSources === 'boolean'
        ? input.assistantPayload.showSources
        : sourceDisplayMeta.showSources,
    sourceDisplayReason:
      typeof input.assistantPayload.sourceDisplayReason === 'string'
        ? input.assistantPayload.sourceDisplayReason
        : sourceDisplayMeta.sourceDisplayReason
  };
};

const joinNaturalLanguageList = (items: string[]): string => {
  const filteredItems = items.map((item) => item.trim()).filter(Boolean);

  if (filteredItems.length <= 1) {
    return filteredItems[0] ?? '';
  }

  if (filteredItems.length === 2) {
    return `${filteredItems[0]} and ${filteredItems[1]}`;
  }

  return `${filteredItems.slice(0, -1).join(', ')}, and ${
    filteredItems[filteredItems.length - 1]
  }`;
};

const extractNamedMatches = (
  text: string,
  definitions: Array<{ label: string; pattern: RegExp }>
): string[] =>
  Array.from(
    new Set(
      definitions
        .filter((definition) => definition.pattern.test(text))
        .map((definition) => definition.label)
    )
  );

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const extractProtectedAttributes = (text: string): string[] =>
  extractNamedMatches(text, [
    { label: 'race', pattern: /\b(race|racial|ethnic|ethnicity|skin colour|skin color|nationality)\b/i },
    { label: 'religion', pattern: /\b(muslim|islam|hijab|headscarf|jewish|christian|religion|faith)\b/i },
    { label: 'disability', pattern: /\b(disability|disabled|wheelchair|autism|mental health condition)\b/i },
    { label: 'sex or gender', pattern: /\b(gender|trans|transgender|woman|women|female|pregnan|mother)\b/i },
    { label: 'sexuality', pattern: /\b(gay|lesbian|queer|sexual orientation)\b/i },
    { label: 'visa status', pattern: /\b(visa status|migrant|migration|immigration|temporary visa|student visa)\b/i },
    { label: 'age', pattern: /\b(age|too old|too young|elderly|old person)\b/i }
  ]);

const extractPrivacyIssueDescriptions = (facts: ConversationFlowStructuredFacts): string[] => {
  const issues: string[] = [];

  if (facts.imageBasedAbuse || facts.privatePhotosOrMessages) {
    issues.push('private photos or intimate content being shared without permission');
  }

  if (facts.onlineThreatBlackmail || facts.blackmailOrExtortion) {
    issues.push('online threats or blackmail');
  }

  if (facts.privacyDataBreach || facts.personalDataLeak) {
    issues.push('privacy or data exposure');
  }

  if (facts.identityTheftRisk || facts.scamFraud || facts.identityDocumentsExposed) {
    issues.push('identity or financial risk');
  }

  if (facts.employerHealthPrivacy) {
    issues.push('a workplace health privacy concern');
  }

  return issues;
};

const buildMatchedFactLabels = (
  facts: Omit<ConversationFlowStructuredFacts, 'matchedFacts'>
): string[] => {
  const matchedFacts: string[] = [];

  if (facts.privacyDataBreach) {
    matchedFacts.push('privacy/data breach');
  }

  if (facts.identityTheftRisk) {
    matchedFacts.push('identity theft risk');
  }

  if (facts.identityDocumentsExposed) {
    matchedFacts.push('identity documents exposed');
  }

  if (facts.bankDetailsExposed) {
    matchedFacts.push('bank or account details exposed');
  }

  if (facts.scamFraud) {
    matchedFacts.push('scam/fraud');
  }

  if (facts.moneyLost) {
    matchedFacts.push('money lost or payment requested');
  }

  if (facts.imageBasedAbuse || facts.privatePhotosOrMessages) {
    matchedFacts.push('image-based abuse/private photos');
  }

  if (facts.onlineThreatBlackmail || facts.blackmailOrExtortion) {
    matchedFacts.push('online threat/blackmail');
  }

  if (facts.employerHealthPrivacy) {
    matchedFacts.push('employer/shared health information');
  }

  if (facts.workplaceBullying) {
    matchedFacts.push('workplace bullying or harassment');
  }

  if (facts.workplaceDiscrimination) {
    matchedFacts.push('workplace discrimination');
  }

  if (facts.domesticViolence) {
    matchedFacts.push('domestic violence');
  }

  if (facts.coerciveControl) {
    matchedFacts.push('coercive control');
  }

  if (facts.migrationOrVisaThreat) {
    matchedFacts.push('migration or visa pressure');
  }

  if (facts.racismDiscrimination) {
    matchedFacts.push('racism/discrimination');
  }

  if (facts.schoolContext) {
    matchedFacts.push('school or youth context');
  }

  if (facts.housingOrServiceContext) {
    matchedFacts.push('housing or service setting');
  }

  if (facts.elderOrVulnerablePerson) {
    matchedFacts.push('elder or vulnerable person involved');
  }

  if (facts.languageOrInterpreterNeed) {
    matchedFacts.push('language or interpreter support may help');
  }

  if (facts.evidenceAvailable) {
    matchedFacts.push('evidence available');
  }

  if (facts.organisations.length > 0) {
    matchedFacts.push(`organisation involved: ${joinNaturalLanguageList(facts.organisations)}`);
  }

  if (facts.platforms.length > 0) {
    matchedFacts.push(`platform involved: ${joinNaturalLanguageList(facts.platforms)}`);
  }

  if (facts.protectedAttributes.length > 0) {
    matchedFacts.push(
      `protected attribute context: ${joinNaturalLanguageList(facts.protectedAttributes)}`
    );
  }

  if (facts.immediateDanger) {
    matchedFacts.push('immediate danger');
  } else if (facts.selfHarmOrSuicidal) {
    matchedFacts.push('self-harm or crisis language');
  } else if (facts.threatsPresent) {
    matchedFacts.push('threat level elevated');
  }

  return matchedFacts;
};

export const extractStructuredTriageFacts = (input: {
  text: string;
  facts?: Partial<ConversationFlowFactsDocument>;
  jurisdiction?: string;
}): ConversationFlowStructuredFacts => {
  const timelineValues =
    input.facts?.timeline && typeof input.facts.timeline === 'object'
      ? Object.values(input.facts.timeline).map((value) => toSafeString(value))
      : [];
  const combinedText = collapseWhitespace(
    [
      input.text,
      input.facts?.whatHappened,
      input.facts?.whenHappened,
      input.facts?.whereHappened,
      input.facts?.peopleInvolved,
      input.facts?.safetyConcerns,
      input.facts?.evidenceMentioned,
      input.facts?.emotionalState,
      ...timelineValues
    ]
      .filter(Boolean)
      .join(' ')
  );
  const lowerCombinedText = combinedText.toLowerCase();
  const workplaceContext = matchesAny(combinedText, [
    /\b(employer|manager|supervisor|coworker|co-worker|colleague|hr|human resources|workplace|at work|office|boss)\b/i
  ]);
  const schoolContext = matchesAny(combinedText, [
    /\b(school|teacher|principal|classmate|class room|classroom|student|university|college|campus)\b/i
  ]);
  const housingOrServiceContext = matchesAny(combinedText, [
    /\b(landlord|real estate|rental|housing|public housing|service counter|restaurant|shop|taxi|rideshare|uber|bus|train|public transport|service provider)\b/i
  ]);
  const employerInvolved = matchesAny(combinedText, [/\b(employer|manager|supervisor|hr|human resources|boss)\b/i]);
  const domesticFamilyContext = matchesAny(combinedText, [
    /\b(partner|husband|wife|boyfriend|girlfriend|spouse|ex partner|ex-partner|family|parent|child|kids|brother|sister|at home)\b/i
  ]);
  const coerciveControl = matchesAny(combinedText, [
    /\b(coercive control|controls? me|monitor(?:s|ed)? me|tracks? me|won.t let me|won't let me|isolat(?:e|ed|es)|takes my pay|checks my phone|keeps me from leaving)\b/i
  ]);
  const healthInformation = matchesAny(combinedText, [
    /\b(health information|medical information|medical details|health details|diagnosis|mental health history|condition)\b/i
  ]);
  const employerHealthPrivacy =
    employerInvolved &&
    healthInformation &&
    matchesAny(combinedText, [/\b(shared|disclosed|told|sent|leaked|exposed|revealed)\b/i]);
  const identityDocumentsExposed = matchesAny(combinedText, [
    /\b(identity theft|passport|driver'?s licen[cs]e|medicare|birth certificate|tax file number|tfn|id\b|identity documents?)\b/i
  ]);
  const bankDetailsExposed = matchesAny(combinedText, [
    /\b(bank details?|bank account|account details?|credit card|debit card|card number|one time code|one-time code|otp|bsb)\b/i
  ]);
  const moneyLost = matchesAny(combinedText, [
    /\b(lost money|sent money|paid them|transferred money|they took my money|money was stolen)\b/i
  ]);
  const privatePhotosOrMessages = matchesAny(combinedText, [
    /\b(private photos?|intimate photos?|nudes?|explicit images?|private messages?|chat logs?|dm|dms)\b/i
  ]);
  const imageBasedAbuse = matchesAny(combinedText, [
    /\b(image-based abuse|revenge porn|shared my photos?|publish my photos?|post my photos?|threat(?:ened)? to share.*photo)\b/i
  ]) || privatePhotosOrMessages;
  const blackmailOrExtortion = matchesAny(combinedText, [
    /\b(blackmail|extort|extortion|unless you pay|unless i pay|pay or i.ll share|pay or i'll share)\b/i
  ]);
  const threatKeywords = [
    /\b(threats?|threatened|death threats?|kill me|kill him|kill her|publish|leak|expose|find me|come back|things will get worse)\b/i
  ];
  const onlineThreatBlackmail =
    blackmailOrExtortion ||
    matchesAny(combinedText, [
      /\b(threat(?:ened)? to publish|threat(?:ened)? to share|publish private messages?|share private messages?|leak private messages?|post private messages?)\b/i
    ]);
  const personalDataLeak =
    matchesAny(combinedText, [
      /\b(data breach|privacy breach|personal details?.*(?:shared|leaked|exposed)|personal information.*(?:shared|leaked|exposed)|private information.*(?:shared|leaked|exposed)|details leaked|information leaked|doxx|doxed|doxxed)\b/i
    ]) || employerHealthPrivacy;
  const protectedAttributes = extractProtectedAttributes(combinedText);
  const protectedAttribute = protectedAttributes.length > 0;
  const racismOrHate = matchesAny(combinedText, [
    /\b(racist|racism|racial abuse|racial slur|hate speech|racial hatred|vilification|go back to where you came from)\b/i
  ]);
  const workplaceDiscrimination =
    workplaceContext &&
    protectedAttribute &&
    matchesAny(combinedText, [
      /\b(because of|due to|treated me differently|refused|excluded|humiliat|underpaid|cut my shifts|fired|dismissed|wouldn.t hire|wouldn't hire)\b/i
    ]);
  const workplaceBullying =
    workplaceContext &&
    matchesAny(combinedText, [
      /\b(workplace bullying|bullying at work|manager humiliat|coworkers? harass|co-?workers? harass|workplace pressure|unsafe at work|boss .*harass|supervisor .*harass|repeatedly humiliate|constantly put me down)\b/i
    ]) &&
    !workplaceDiscrimination;
  const migrationOrVisaThreat = matchesAny(combinedText, [
    /\b(visa scam|immigration scam|migration scam|visa status|migration status|fix my visa|report me to immigration|cancel my visa|cancel my sponsorship|deport me|home affairs|registered migration agent|migration agent|immigration agent)\b/i
  ]);
  const elderOrVulnerablePerson = matchesAny(combinedText, [
    /\b(elderly|older parent|older person|aged care|grandma|grandfather|grandmother|pensioner|vulnerable person)\b/i
  ]);
  const physicalViolence = matchesAny(combinedText, [
    /\b(hit|hurt|assault|slap|punch|kick|strangle|choke|beat|grabbed me|pulled me)\b/i
  ]);
  const threatsPresent = matchesAny(combinedText, threatKeywords) || onlineThreatBlackmail;
  const immediateDanger = matchesAny(lowerCombinedText, [
    /\b(immediate danger|unsafe now|call 000|weapon|gun|shoot|shot|strangled|strangle|can.t breathe|death threat|kill me|kill him|kill her|coming now)\b/i
  ]);
  const selfHarmOrSuicidal = matchesAny(lowerCombinedText, [
    /\b(self-harm|suicide|suicidal|hurt myself|end my life)\b/i
  ]);
  const languageOrInterpreterNeed = matchesAny(combinedText, [
    /\b(interpreter|translation|translate|english is not my first language|don.t speak english|don't speak english|language support)\b/i
  ]);
  const organisations = extractNamedMatches(combinedText, [
    { label: 'company', pattern: /\bcompany\b/i },
    { label: 'organisation', pattern: /\borganisation|organization|agency|business\b/i },
    { label: 'employer', pattern: /\bemployer\b/i },
    { label: 'bank', pattern: /\bbank\b/i },
    { label: 'workplace', pattern: /\bworkplace\b/i },
    { label: 'school', pattern: /\b(school|university|college)\b/i },
    { label: 'platform', pattern: /\b(platform|social media)\b/i }
  ]);
  const platforms = extractNamedMatches(combinedText, [
    { label: 'instagram', pattern: /\binstagram\b/i },
    { label: 'facebook', pattern: /\bfacebook\b/i },
    { label: 'tiktok', pattern: /\btiktok\b/i },
    { label: 'snapchat', pattern: /\bsnapchat\b/i },
    { label: 'whatsapp', pattern: /\bwhatsapp\b/i },
    { label: 'discord', pattern: /\bdiscord\b/i },
    { label: 'email', pattern: /\bemail\b/i },
    { label: 'sms', pattern: /\btext message|sms\b/i }
  ]);
  const structuredFacts: Omit<ConversationFlowStructuredFacts, 'matchedFacts'> = {
    privacyDataBreach: personalDataLeak,
    identityTheftRisk:
      identityDocumentsExposed ||
      bankDetailsExposed ||
      matchesAny(combinedText, [/\b(date of birth|dob|identity theft)\b/i]),
    scamFraud: matchesAny(combinedText, [
      /\b(scam|scammer|fraud|phishing|fake link|fake migration agent|account hacked|stole my money|took my money|impersonation)\b/i
    ]),
    imageBasedAbuse,
    onlineThreatBlackmail,
    employerHealthPrivacy,
    workplaceBullying,
    workplaceContext,
    racismDiscrimination:
      racismOrHate ||
      workplaceDiscrimination ||
      (protectedAttribute &&
        (housingOrServiceContext || schoolContext) &&
        matchesAny(combinedText, [/\b(discrimination|abuse|refused|excluded|harass|slur|hate)\b/i])),
    domesticViolence:
      matchesAny(combinedText, [/\b(domestic violence|family violence|family harm)\b/i]) ||
      (domesticFamilyContext &&
        (physicalViolence || coerciveControl || threatsPresent || migrationOrVisaThreat)),
    physicalViolence,
    threatsPresent,
    immediateDanger: immediateDanger || selfHarmOrSuicidal,
    evidenceAvailable:
      matchesAny(combinedText, [
        /\b(screenshot|screenshots|message|messages|email|emails|photo|photos|recording|recordings|witness|witnesses|bank statement|receipt|receipts|link|url|username)\b/i
      ]) || Boolean(input.facts?.evidenceMentioned?.trim()),
    domesticFamilyContext,
    coerciveControl,
    blackmailOrExtortion,
    privatePhotosOrMessages,
    personalDataLeak,
    companyOrOrganisationInvolved: organisations.length > 0,
    employerInvolved,
    healthInformation,
    identityDocumentsExposed,
    bankDetailsExposed,
    moneyLost,
    protectedAttribute,
    schoolContext,
    workplaceDiscrimination,
    housingOrServiceContext,
    elderOrVulnerablePerson,
    migrationOrVisaThreat,
    languageOrInterpreterNeed,
    selfHarmOrSuicidal,
    organisations,
    platforms,
    protectedAttributes,
    jurisdiction: input.jurisdiction
  };

  return {
    ...structuredFacts,
    matchedFacts: buildMatchedFactLabels(structuredFacts)
  };
};

export const buildRelatedIssueTypes = (
  category: ConversationFlowCategory,
  facts: ConversationFlowStructuredFacts
): string[] => {
  const relatedIssueTypes = new Set<string>([category]);

  if (facts.scamFraud || facts.identityTheftRisk) {
    relatedIssueTypes.add('scam_fraud');
    relatedIssueTypes.add('identity_risk');
  }

  if (facts.privacyDataBreach || facts.personalDataLeak) {
    relatedIssueTypes.add('online_abuse');
    relatedIssueTypes.add('privacy_data_breach');
  }

  if (facts.imageBasedAbuse || facts.privatePhotosOrMessages) {
    relatedIssueTypes.add('online_abuse');
    relatedIssueTypes.add('image_based_abuse');
  }

  if (facts.onlineThreatBlackmail || facts.blackmailOrExtortion || facts.threatsPresent) {
    relatedIssueTypes.add('harassment');
    relatedIssueTypes.add('online_threats');
  }

  if (facts.blackmailOrExtortion) {
    relatedIssueTypes.add('blackmail_extortion');
  }

  if (facts.employerHealthPrivacy) {
    relatedIssueTypes.add('workplace_privacy');
  }

  if (facts.workplaceBullying) {
    relatedIssueTypes.add('workplace_bullying');
  }

  if (facts.workplaceDiscrimination) {
    relatedIssueTypes.add('racism_discrimination');
    relatedIssueTypes.add('workplace_discrimination');
  }

  if (facts.domesticViolence) {
    relatedIssueTypes.add('domestic_violence');
    relatedIssueTypes.add('domestic_family_violence');
  }

  if (facts.coerciveControl) {
    relatedIssueTypes.add('coercive_control');
  }

  if (facts.racismDiscrimination) {
    relatedIssueTypes.add('racism_discrimination');
    relatedIssueTypes.add('racism_hate');
  }

  if (facts.schoolContext && facts.racismDiscrimination) {
    relatedIssueTypes.add('school_racism');
  } else if (facts.schoolContext) {
    relatedIssueTypes.add('school_bullying');
  }

  if (facts.housingOrServiceContext && facts.racismDiscrimination) {
    relatedIssueTypes.add('housing_or_service_discrimination');
  }

  if (facts.elderOrVulnerablePerson && (facts.scamFraud || facts.identityTheftRisk)) {
    relatedIssueTypes.add('elder_scam');
  }

  if (facts.migrationOrVisaThreat) {
    relatedIssueTypes.add('migration_visa_coercion');
  }

  if (facts.languageOrInterpreterNeed) {
    relatedIssueTypes.add('interpreter_support');
  }

  return Array.from(relatedIssueTypes);
};

export const buildConversationFlowCategoryLabel = (
  category: ConversationFlowCategory,
  facts: ConversationFlowStructuredFacts
): string => {
  if (category === 'general_support') {
    return 'Review Your Options';
  }

  if (
    facts.employerHealthPrivacy &&
    !facts.workplaceBullying &&
    !facts.workplaceDiscrimination &&
    !facts.scamFraud &&
    !facts.imageBasedAbuse &&
    !facts.onlineThreatBlackmail
  ) {
    return 'Workplace Privacy Concern';
  }

  if (category === 'domestic_violence') {
    return 'Domestic/Family Violence Safety Support';
  }

  if (category === 'online_abuse') {
    if ((facts.imageBasedAbuse || facts.privatePhotosOrMessages) && facts.onlineThreatBlackmail) {
      return 'Image-Based Abuse & Online Threat Support';
    }

    if (facts.imageBasedAbuse) {
      return 'Image-Based Abuse Support';
    }

    if (facts.onlineThreatBlackmail || facts.threatsPresent) {
      return 'Online Abuse & Threat Support';
    }

    if (
      (facts.privacyDataBreach || facts.personalDataLeak) &&
      (facts.onlineThreatBlackmail || facts.imageBasedAbuse || facts.employerHealthPrivacy)
    ) {
      return 'Privacy, Data Breach & Online Threat Support';
    }

    if (facts.privacyDataBreach || facts.identityTheftRisk || facts.scamFraud) {
      return 'Cyber Safety & Privacy Support';
    }
  }

  if (category === 'scam_fraud') {
    if (facts.elderOrVulnerablePerson) {
      return 'Elder Scam & Identity Risk Support';
    }

    if (facts.migrationOrVisaThreat) {
      return 'Scam, Identity & Migration Risk Support';
    }

    if (facts.identityTheftRisk) {
      return 'Scam & Identity Risk Support';
    }
  }

  if (category === 'racism_discrimination') {
    if (facts.schoolContext && facts.racismDiscrimination) {
      return 'School Racism or Hate Support';
    }

    if (facts.workplaceDiscrimination) {
      return 'Workplace Discrimination Support';
    }

    if (facts.housingOrServiceContext) {
      return 'Discrimination in Housing or Services Support';
    }

    if (facts.threatsPresent) {
      return 'Racism, Hate, or Public Abuse Support';
    }
  }

  if (category === 'harassment' && facts.schoolContext) {
    return 'School Bullying Support';
  }

  return categoryLabels[category];
};

const buildMatchedResourceTypesFromFacts = (
  category: ConversationFlowCategory,
  facts: ConversationFlowStructuredFacts
): string[] => {
  const resourceTypes = new Set<string>(['evidence_guidance', 'mental_health']);

  if (facts.immediateDanger || facts.selfHarmOrSuicidal) {
    resourceTypes.add('emergency');
    resourceTypes.add('police');
    resourceTypes.add('safety_planning');
  } else if (facts.threatsPresent || facts.physicalViolence) {
    resourceTypes.add('police');
    resourceTypes.add('safety_planning');
  }

  if (facts.privacyDataBreach || facts.imageBasedAbuse || facts.onlineThreatBlackmail) {
    resourceTypes.add('online_safety');
    resourceTypes.add('government');
  }

  if (facts.scamFraud || facts.identityTheftRisk) {
    resourceTypes.add('scam_support');
    resourceTypes.add('government');
    resourceTypes.add('online_safety');
  }

  if (facts.employerHealthPrivacy || facts.workplaceBullying || facts.workplaceDiscrimination) {
    resourceTypes.add('workplace_body');
    resourceTypes.add('legal');
    resourceTypes.add('government');
  }

  if (facts.racismDiscrimination || facts.workplaceDiscrimination) {
    resourceTypes.add('anti_discrimination_body');
    resourceTypes.add('government');
  }

  if (facts.domesticViolence) {
    resourceTypes.add('domestic_violence_agency');
    resourceTypes.add('safety_planning');
    resourceTypes.add('council_support');
  }

  if (facts.schoolContext || facts.elderOrVulnerablePerson || facts.languageOrInterpreterNeed) {
    resourceTypes.add('government');
    resourceTypes.add('council_support');
  }

  if (facts.migrationOrVisaThreat) {
    resourceTypes.add('legal');
    resourceTypes.add('government');
    resourceTypes.add('scam_support');
  }

  const fallbackResourceTypes = categoryDetectionRules.find(
    (rule) => rule.category === category
  )?.resourceTypes;

  fallbackResourceTypes?.forEach((resourceType) => {
    resourceTypes.add(resourceType);
  });

  return Array.from(resourceTypes);
};

const buildCardReasonSummary = (facts: ConversationFlowStructuredFacts): string => {
  const reasons = [
    facts.privacyDataBreach ? 'privacy and data exposure' : '',
    facts.identityTheftRisk ? 'identity protection' : '',
    facts.imageBasedAbuse ? 'image-based abuse' : '',
    facts.onlineThreatBlackmail ? 'online threats or blackmail' : '',
    facts.employerHealthPrivacy ? 'workplace privacy concerns' : '',
    facts.workplaceBullying ? 'workplace bullying' : '',
    facts.workplaceDiscrimination ? 'workplace discrimination' : '',
    facts.racismDiscrimination ? 'racism or hate-based abuse' : '',
    facts.domesticViolence ? 'domestic or family violence' : '',
    facts.migrationOrVisaThreat ? 'migration or visa pressure' : '',
    facts.schoolContext ? 'school context' : '',
    facts.languageOrInterpreterNeed ? 'language support needs' : '',
    facts.evidenceAvailable ? 'evidence preservation' : ''
  ].filter(Boolean);

  return reasons.length > 0
    ? `Matched to ${joinNaturalLanguageList(reasons)} signals.`
    : 'Matched to the current triage profile.';
};

export const buildConversationFlowPresentation = (input: {
  category: ConversationFlowCategory;
  facts: ConversationFlowStructuredFacts;
  riskLevel: ConversationFlowRiskLevel;
  label?: string;
}): ConversationFlowTriagePresentationRecord => {
  const label = input.label ?? buildConversationFlowCategoryLabel(input.category, input.facts);
  const assessmentNote = 'This is not a formal finding. You choose what to do next.';
  const immediateDangerBody =
    input.facts.immediateDanger || input.riskLevel === 'immediate'
      ? 'If you are in immediate danger, think someone may act now, or you cannot stay safe, call 000 immediately.'
      : input.facts.selfHarmOrSuicidal
        ? 'If you may hurt yourself or someone else, call 000 now. If you want crisis support and it feels safe, Lifeline is available on 13 11 14.'
        : input.facts.threatsPresent || input.riskLevel === 'high'
          ? 'If the threats escalate or you feel unsafe, put immediate safety first and consider calling 000.'
          : 'If safety changes at any point, you can stop here and use emergency or support options first.';

  if (input.category === 'general_support') {
    return {
      title: 'Review Your Options',
      body:
        'SafeSpeak does not have enough clear detail to place this into one strong pathway yet. You can review the facts, update anything important, and then look through broad support options.',
      assessmentNote,
      primaryStepTitle: 'Check or edit the key facts',
      primaryStepBody:
        'Add the main details that feel safest to share, such as what happened, who was involved, where it happened, and any immediate safety worries.',
      immediateDangerBody,
      secondTitle: 'Review broad support options',
      secondBody:
        'You can still look through support, reporting, privacy, and safety options without locking yourself into one path.',
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle: 'Get support if this feels overwhelming',
      thirdBody:
        'You can choose emotional support now even if you are not ready to report or take another step.',
      thirdActionLabel: 'Find support',
      thirdActionHref: '/dashboard/explorer',
      stepReasons: ['the current facts are mixed or incomplete', 'a broad review path is safer than over-classifying'],
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (input.category === 'domestic_violence') {
    return {
      title: label,
      body:
        'From what you shared, this may involve domestic or family violence or controlling behaviour. Safety comes first here, and you can look at support and next steps at your own pace.',
      assessmentNote,
      primaryStepTitle: 'Put safety first',
      primaryStepBody:
        'If it feels safe, focus on where you can go, who you can contact, and what essentials you may need. Do not collect more evidence if that could increase the danger.',
      immediateDangerBody,
      secondTitle: 'Get confidential family violence support',
      secondBody:
        'If it is safe to do so, 1800RESPECT can help with confidential safety planning and support options.',
      secondActionLabel: 'Get support',
      secondActionHref: '/dashboard/explorer',
      thirdTitle: 'Save evidence only if it feels safe',
      thirdBody:
        'If evidence is already available and it feels safe, keep messages, photos, dates, and notes somewhere the other person cannot access.',
      thirdActionLabel: 'Evidence steps',
      thirdActionHref: '/dashboard?view=reportsubmissionevidence',
      stepReasons: [
        'domestic or family context was detected',
        input.facts.coerciveControl ? 'coercive control indicators were detected' : 'safety risk is elevated',
        input.facts.migrationOrVisaThreat ? 'migration or visa pressure was also detected' : 'support can start without making a report'
      ].filter(Boolean),
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (input.category === 'workplace_bullying' && input.facts.workplaceBullying) {
    return {
      title: 'Workplace Bullying Support',
      body:
        'From what you shared, this may involve bullying, humiliation, harassment, or pressure at work. You can keep a clear record, review workplace options, and get support without making a report right away.',
      assessmentNote,
      primaryStepTitle: 'Record the pattern',
      primaryStepBody:
        'If it feels safe, keep dates, messages, witnesses, rosters, and short notes about what happened and how often it happened.',
      immediateDangerBody,
      secondTitle: 'Review workplace options',
      secondBody:
        'You can review workplace, HR, union, regulator, Fair Work, or legal information options without making a report yet.',
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle: 'Get support',
      thirdBody:
        'You can speak with a support service if the stress, humiliation, or pressure is affecting your wellbeing.',
      thirdActionLabel: 'Find support',
      thirdActionHref: '/dashboard/explorer',
      stepReasons: ['workplace bullying or harassment indicators matched', 'workplace-specific evidence can help'],
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (
    input.facts.employerHealthPrivacy &&
    !input.facts.workplaceBullying &&
    !input.facts.workplaceDiscrimination &&
    !input.facts.scamFraud
  ) {
    return {
      title: 'Workplace Privacy Concern',
      body:
        'From what you shared, this may involve a workplace privacy concern, including health information being shared without permission. You can focus on keeping a clear record, asking what was disclosed, and reviewing privacy options without rushing.',
      assessmentNote,
      primaryStepTitle: 'Save evidence and key details',
      primaryStepBody:
        'Keep messages, emails, screenshots, dates, and notes about who shared the information and who received it.',
      immediateDangerBody,
      secondTitle: 'Ask what was shared and why',
      secondBody:
        'You can ask the employer or organisation what information was disclosed, why it was shared, and what they will do next.',
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle: 'Consider privacy pathways',
      thirdBody:
        'You can look at workplace, privacy, regulator, or legal information pathways, including OAIC or workplace complaint options where appropriate.',
      thirdActionLabel: 'Evidence steps',
      thirdActionHref: '/dashboard?view=reportsubmissionevidence',
      stepReasons: [
        'employer/shared health information matched',
        input.facts.workplaceDiscrimination
          ? 'workplace discrimination signals were weaker than the privacy issue'
          : 'no strong bullying pattern was detected',
        'privacy and evidence steps are more relevant than a bullying pathway'
      ],
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (
    input.category === 'online_abuse' ||
    input.category === 'scam_fraud' ||
    input.facts.privacyDataBreach ||
    input.facts.imageBasedAbuse ||
    input.facts.onlineThreatBlackmail
  ) {
    const issueDescription =
      joinNaturalLanguageList(extractPrivacyIssueDescriptions(input.facts)) ||
      'online abuse, privacy, or identity risk';
    const secondBodySegments = [
      input.facts.imageBasedAbuse || input.facts.onlineThreatBlackmail
        ? 'You can report abusive content, threats, or image-based abuse to the platform involved and review eSafety options.'
        : '',
      input.facts.privacyDataBreach
        ? 'You can ask the company or organisation what data was exposed, how it happened, and what they are doing about it.'
        : '',
      input.facts.scamFraud || input.facts.identityTheftRisk
        ? 'If accounts, identity documents, or money are involved, ReportCyber or Scamwatch may be worth reviewing.'
        : '',
      input.facts.employerHealthPrivacy
        ? 'If the issue involves an employer sharing health information, you can also ask what was shared and why.'
        : '',
      input.facts.privacyDataBreach || input.facts.employerHealthPrivacy
        ? 'It may also be worth considering OAIC or privacy complaint options where appropriate.'
        : ''
    ].filter(Boolean);
    const thirdTitle = input.facts.employerHealthPrivacy
      ? 'Keep a short record of the workplace privacy issue'
      : input.facts.privacyDataBreach
        ? 'Ask what was exposed and what is being fixed'
        : 'Get support while you decide next steps';
    const thirdBody = input.facts.employerHealthPrivacy
      ? 'Keep a short timeline of who shared the information, who received it, and how the disclosure has affected you.'
      : input.facts.privacyDataBreach
        ? 'Save the breach notice or messages and note what response the organisation gives you.'
        : 'If the threats, privacy breach, or scam feel overwhelming, you can get support while you decide what to do next.';

    return {
      title: /support$/i.test(label) ? label : `${label} Support`,
      body: `From what you shared, this may involve ${issueDescription}. You can focus on safety, account protection, evidence, and reporting options without doing everything at once.`,
      assessmentNote,
      primaryStepTitle:
        input.facts.identityTheftRisk || input.facts.scamFraud
          ? 'Protect accounts, bank details, and identity information'
          : input.facts.imageBasedAbuse || input.facts.onlineThreatBlackmail
            ? 'Save evidence somewhere private'
            : 'Protect your information and save evidence',
      primaryStepBody:
        input.facts.identityTheftRisk || input.facts.scamFraud
          ? 'If it feels safe, change passwords, contact your bank, turn on extra security, watch for misuse of your identity details, and avoid sending more money, codes, or documents.'
          : 'If it feels safe, save screenshots, usernames, links, messages, and dates in a private place, and avoid deleting the original messages.',
      immediateDangerBody,
      secondTitle:
        input.facts.imageBasedAbuse || input.facts.onlineThreatBlackmail
          ? 'Report the content or account issue'
          : 'Review reporting and privacy options',
      secondBody: secondBodySegments.join(' '),
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle,
      thirdBody,
      thirdActionLabel:
        input.facts.employerHealthPrivacy || input.facts.privacyDataBreach || input.facts.evidenceAvailable
          ? 'Evidence steps'
          : 'Find support',
      thirdActionHref:
        input.facts.employerHealthPrivacy || input.facts.privacyDataBreach || input.facts.evidenceAvailable
          ? '/dashboard?view=reportsubmissionevidence'
          : '/dashboard/explorer',
      stepReasons: [
        input.facts.identityTheftRisk || input.facts.scamFraud
          ? 'identity or account risk matched'
          : 'privacy and evidence preservation matched',
        input.facts.imageBasedAbuse || input.facts.onlineThreatBlackmail
          ? 'platform abuse or online threat signals matched'
          : 'privacy/data exposure matched',
        input.facts.employerHealthPrivacy
          ? 'workplace health privacy concern also matched'
          : 'support remains available while the person decides next steps'
      ].filter(Boolean),
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (input.category === 'racism_discrimination') {
    const reportingBody = input.facts.schoolContext
      ? 'You can review options with a parent, guardian, school wellbeing contact, principal, education department, or anti-discrimination body, depending on what happened.'
      : input.facts.workplaceDiscrimination
        ? 'You can review workplace, Fair Work, anti-discrimination, police, or legal information options where they fit the facts.'
        : input.facts.housingOrServiceContext
          ? 'You can review complaint options with the provider, anti-discrimination pathways, or police if threats were involved.'
          : 'You can review anti-discrimination, police, community, or eSafety options depending on where the abuse happened.';
    return {
      title: label,
      body:
        'From what you shared, this may involve racism, discrimination, or hate-based abuse. You can keep a factual record, review reporting options, and get support without having to decide everything now.',
      assessmentNote,
      primaryStepTitle: input.facts.immediateDanger ? 'Put safety first and save only what feels safe' : 'Record the details clearly',
      primaryStepBody:
        'If it feels safe, record the exact words or actions, the time and place, any witnesses, and any screenshots or photos that help explain what happened.',
      immediateDangerBody,
      secondTitle: 'Review rights and reporting options',
      secondBody: reportingBody,
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle: input.facts.languageOrInterpreterNeed ? 'Ask for language or interpreter support' : 'Get support',
      thirdBody:
        input.facts.languageOrInterpreterNeed
          ? 'If English is a barrier, you can ask for interpreter support when contacting a service or complaint body.'
          : 'You can reach out to a support service if the incident feels upsetting, isolating, or unsafe.',
      thirdActionLabel: input.facts.languageOrInterpreterNeed ? 'Review options' : 'Find support',
      thirdActionHref: '/dashboard/explorer',
      stepReasons: [
        'racism, hate, or discrimination indicators matched',
        input.facts.schoolContext ? 'school context was detected' : '',
        input.facts.workplaceDiscrimination ? 'workplace discrimination indicators matched' : 'rights and evidence pathways may be relevant'
      ].filter(Boolean),
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (input.category === 'harassment' && input.facts.schoolContext) {
    return {
      title: label,
      body:
        'From what you shared, this may involve school bullying or harassment. You can keep a short record, ask for support, and look at school options at a pace that feels manageable.',
      assessmentNote,
      primaryStepTitle: 'Write down what happened',
      primaryStepBody:
        'If it feels safe, note what happened, when and where it happened, who was involved, and any messages or screenshots you already have.',
      immediateDangerBody,
      secondTitle: 'Review school support options',
      secondBody:
        'You can ask a parent, guardian, school wellbeing worker, teacher, principal, or education department pathway for support.',
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle: 'Get support',
      thirdBody:
        'You can speak with a support person or service if the situation feels upsetting, isolating, or unsafe.',
      thirdActionLabel: 'Find support',
      thirdActionHref: '/dashboard/explorer',
      stepReasons: ['school context was detected', 'a youth-friendly bullying pathway is more relevant than a generic harassment path'],
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (input.category === 'mental_health_distress') {
    return {
      title: 'Emotional Support',
      body:
        'From what you shared, you may need emotional support. You can take this slowly and choose support options that feel manageable.',
      assessmentNote: 'This is not a clinical diagnosis.',
      primaryStepTitle: "Start with one small safe step",
      primaryStepBody: 'Grounding, support, and one manageable next action can be enough for now.',
      immediateDangerBody,
      secondTitle: 'Immediate support',
      secondBody:
        'If you may hurt yourself or someone else, or you are in immediate danger, call 000 now.',
      secondActionLabel: 'Contact emergency support',
      secondActionHref: '/dashboard?view=reportsubmissionevidence',
      thirdTitle: 'Counselling support',
      thirdBody:
        'You can speak confidentially with a crisis counsellor or mental health support service.',
      thirdActionLabel: 'Find support',
      thirdActionHref: '/dashboard/explorer',
      stepReasons: ['mental distress indicators matched', 'support and safety steps should stay simple'],
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  return {
    title: `${label} Support`,
    body: `From what you shared, this may fit a ${label.toLowerCase()} pathway. You can explore support, reporting, evidence, and safety options without pressure.`,
    assessmentNote,
    primaryStepTitle: 'Review your options',
    primaryStepBody:
      'Choose what feels safest: support services, reporting options, evidence, or safety planning.',
    immediateDangerBody,
    secondTitle: 'Reporting options',
    secondBody: 'You can review possible reporting pathways and decide what feels safe.',
    secondActionLabel: 'Review reporting',
    secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
    thirdTitle: 'Emotional support',
    thirdBody:
      'You can speak with a support service if this feels stressful, upsetting, or unsafe.',
    thirdActionLabel: 'Find support',
    thirdActionHref: '/dashboard/explorer',
    stepReasons: ['general triage pathway selected'],
    microCardSummary: buildCardReasonSummary(input.facts)
  };
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

const getRecordString = (record: Record<string, unknown>, key: string, fallback = ''): string =>
  toSafeString(record[key], fallback);

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
    /\b(immediate danger|unsafe now|kill me|suicide|self[- ]?harm|weapon|gun|shoot|shot|strangled|can.t breathe)\b/i.test(
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
    showSources: false,
    sourceDisplayReason: 'hidden_support_reply',
    rag: {
      used: false,
      unavailable: true,
      resultCount: 0
    },
    reviewStatus: 'fallback_local'
  };
};

export const detectCategory = (input: {
  text: string;
  selectedTopic?: string;
  structuredFacts?: ConversationFlowStructuredFacts;
}): {
  category: ConversationFlowCategory;
  confidenceScore: number;
  evidenceScore: number;
  matchedResourceTypes: string[];
  relatedIssueTypes: string[];
} => {
  const structuredFacts =
    input.structuredFacts ??
    extractStructuredTriageFacts({
      text: input.text
    });
  const legacyMatches = categoryDetectionRules.map((rule) => {
    let keywordScore = 0;

    for (const keyword of rule.keywords) {
      if (keyword.test(input.text)) {
        keywordScore += 1;
      }
    }

    return {
      category: rule.category,
      keywordScore,
      selectedTopicScore: rule.selectedTopics?.includes(input.selectedTopic ?? '') ? 0.75 : 0
    };
  });
  const baseScores = Object.fromEntries(
    legacyMatches.map((match) => [
      match.category,
      match.keywordScore + match.selectedTopicScore
    ])
  ) as Record<ConversationFlowCategory, number>;
  const strongFactCount = [
    structuredFacts.domesticViolence,
    structuredFacts.coerciveControl,
    structuredFacts.imageBasedAbuse,
    structuredFacts.onlineThreatBlackmail,
    structuredFacts.scamFraud,
    structuredFacts.identityTheftRisk,
    structuredFacts.racismDiscrimination,
    structuredFacts.workplaceBullying,
    structuredFacts.workplaceDiscrimination,
    structuredFacts.employerHealthPrivacy
  ].filter(Boolean).length;
  const scores: Record<ConversationFlowCategory, number> = {
    domestic_violence:
      baseScores.domestic_violence +
      (structuredFacts.domesticViolence ? 9 : 0) +
      (structuredFacts.coerciveControl ? 4 : 0) +
      (structuredFacts.migrationOrVisaThreat && structuredFacts.domesticFamilyContext ? 3 : 0) +
      (structuredFacts.physicalViolence ? 2 : 0) +
      (structuredFacts.immediateDanger ? 2 : 0),
    workplace_bullying:
      baseScores.workplace_bullying +
      (structuredFacts.workplaceBullying ? 8 : 0) +
      (structuredFacts.workplaceContext && structuredFacts.workplaceBullying ? 2 : 0) -
      (!structuredFacts.workplaceBullying && structuredFacts.employerHealthPrivacy ? 4 : 0) -
      (structuredFacts.workplaceDiscrimination ? 3 : 0),
    racism_discrimination:
      baseScores.racism_discrimination +
      (structuredFacts.racismDiscrimination ? 8 : 0) +
      (structuredFacts.workplaceDiscrimination ? 4 : 0) +
      (structuredFacts.housingOrServiceContext && structuredFacts.racismDiscrimination ? 3 : 0) +
      (structuredFacts.schoolContext && structuredFacts.racismDiscrimination ? 2 : 0) +
      (structuredFacts.threatsPresent ? 1 : 0),
    online_abuse:
      baseScores.online_abuse +
      (structuredFacts.imageBasedAbuse ? 8 : 0) +
      (structuredFacts.privatePhotosOrMessages ? 3 : 0) +
      (structuredFacts.onlineThreatBlackmail ? 6 : 0) +
      (structuredFacts.blackmailOrExtortion ? 3 : 0) +
      (structuredFacts.privacyDataBreach ? 4 : 0) +
      (structuredFacts.employerHealthPrivacy ? 2 : 0) +
      (structuredFacts.platforms.length > 0 ? 2 : 0) +
      (structuredFacts.organisations.length > 0 ? 0.5 : 0) +
      (structuredFacts.threatsPresent ? 1 : 0),
    scam_fraud:
      baseScores.scam_fraud +
      (structuredFacts.scamFraud ? 8 : 0) +
      (structuredFacts.identityTheftRisk ? 5 : 0) +
      (structuredFacts.moneyLost ? 3 : 0) +
      (structuredFacts.migrationOrVisaThreat ? 2 : 0) +
      (structuredFacts.elderOrVulnerablePerson ? 2 : 0) +
      (structuredFacts.privacyDataBreach ? 1 : 0),
    theft_property:
      baseScores.theft_property + (structuredFacts.physicalViolence && !structuredFacts.workplaceContext ? 1 : 0),
    harassment:
      baseScores.harassment +
      (structuredFacts.threatsPresent ? 3 : 0) +
      (structuredFacts.imageBasedAbuse ? 1 : 0) +
      (structuredFacts.schoolContext ? 2 : 0),
    mental_health_distress:
      baseScores.mental_health_distress + (structuredFacts.selfHarmOrSuicidal ? 6 : 0),
    general_support: 0
  };

  const matches = (Object.entries(scores) as Array<[ConversationFlowCategory, number]>)
    .map(([category, score]) => ({
      category,
      score,
      keywordScore: legacyMatches.find((match) => match.category === category)?.keywordScore ?? 0
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (matches.length === 0) {
    const fallbackCategory = input.selectedTopic
      ? selectedTopicFallbackCategory(input.selectedTopic)
      : 'general_support';

    return {
      category: fallbackCategory,
      confidenceScore: input.selectedTopic ? 0.32 : 0.2,
      evidenceScore: 0,
      matchedResourceTypes: buildMatchedResourceTypesFromFacts(
        fallbackCategory,
        structuredFacts
      ),
      relatedIssueTypes: buildRelatedIssueTypes(fallbackCategory, structuredFacts)
    };
  }

  const best = matches[0];
  const runnerUpScore = matches[1]?.score ?? 0;
  const gap = Math.max(best.score - runnerUpScore, 0);
  const confidenceScore = Math.min(
    0.95,
    0.28 +
      Math.min(best.score, 10) * 0.055 +
      Math.min(best.keywordScore, 3) * 0.035 +
      Math.min(gap, 5) * 0.025 +
      Math.min(strongFactCount, 4) * 0.02
  );
  const shouldUseBroadReviewPath =
    best.score < 3 ||
    (best.score < 5 && gap < 1.5 && strongFactCount < 2) ||
    (best.category === 'workplace_bullying' &&
      !structuredFacts.workplaceBullying &&
      structuredFacts.employerHealthPrivacy);

  if (shouldUseBroadReviewPath) {
    return {
      category: 'general_support',
      confidenceScore: Math.min(confidenceScore, 0.42),
      evidenceScore: Math.max(best.keywordScore, strongFactCount),
      matchedResourceTypes: buildMatchedResourceTypesFromFacts('general_support', structuredFacts),
      relatedIssueTypes: buildRelatedIssueTypes('general_support', structuredFacts)
    };
  }

  return {
    category: best.category,
    confidenceScore,
    evidenceScore: Math.max(best.keywordScore, structuredFacts.matchedFacts.length),
    matchedResourceTypes: buildMatchedResourceTypesFromFacts(best.category, structuredFacts),
    relatedIssueTypes: buildRelatedIssueTypes(best.category, structuredFacts)
  };
};

const detectSafetyRiskLevel = (
  text: string,
  facts: Partial<ConversationFlowFactsDocument>
): ConversationFlowRiskLevel => {
  const combined =
    `${text}\n${facts.safetyConcerns ?? ''}\n${facts.emotionalState ?? ''}`.toLowerCase();

  if (
    /\b(immediate danger|kill me|kill him|kill her|call 000|unsafe now|weapon|gun|shoot|shot|strangled|strangle|can.t breathe|suicide|suicidal|self-harm|death threat)\b/i.test(
      combined
    )
  ) {
    return 'immediate';
  }

  if (
    /\b(threat|hit|assault|injured|stalking|followed|find me|come back|things will get worse|scared to go home|afraid to go home|blackmail|extort|publish my photos|publish my messages)\b/i.test(
      combined
    )
  ) {
    return 'high';
  }

  if (/\b(anxious|overwhelmed|panic|distress|worried|harassed|unsafe|bullied)\b/i.test(combined)) {
    return 'medium';
  }

  return 'low';
};

const hasEnoughContextForTriageAssessment = (
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
  triage.confidenceScore < ACTIONABLE_TRIAGE_CONFIDENCE_THRESHOLD ||
  !triage.canProceedToRecommendations;

const buildReasoningSummary = (input: {
  category: ConversationFlowCategory;
  riskLevel: ConversationFlowRiskLevel;
  facts: Partial<ConversationFlowFactsDocument>;
  structuredFacts: ConversationFlowStructuredFacts;
  missingInformation: string[];
}): string => {
  const categoryLabel = buildConversationFlowCategoryLabel(input.category, input.structuredFacts);
  const issueDescription = joinNaturalLanguageList(
    extractPrivacyIssueDescriptions(input.structuredFacts)
  );
  const contextHints = [
    input.structuredFacts.workplaceDiscrimination ? 'possible workplace discrimination' : '',
    input.structuredFacts.workplaceBullying ? 'possible workplace bullying' : '',
    input.structuredFacts.schoolContext ? 'a school or youth context' : '',
    input.structuredFacts.migrationOrVisaThreat ? 'migration or visa pressure' : '',
    input.structuredFacts.elderOrVulnerablePerson ? 'an older or vulnerable person may be affected' : ''
  ].filter(Boolean);
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

  if (input.category === 'general_support') {
    const contextText = contextHints.length > 0 ? ` I also noticed ${joinNaturalLanguageList(contextHints)}.` : '';

    return `SafeSpeak does not have enough detail to place this into one strong pathway yet.${contextText}${riskText}${missingText}`.trim();
  }

  if (issueDescription) {
    const contextText = contextHints.length > 0 ? ` I also noticed ${joinNaturalLanguageList(contextHints)}.` : '';

    return `Based on what you shared so far, this looks most like ${categoryLabel.toLowerCase()}. I also picked up ${issueDescription}.${contextText}${riskText}${missingText}`.replace(
      /\.\s+\./g,
      '.'
    ).trim();
  }

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
  issueTypes: ConversationFlowCategory[];
  riskLevel: ConversationFlowRiskLevel;
  matchedResourceTypes: string[];
  jurisdiction?: string;
}) => ({
  isPublished: true,
  isActive: true,
  jurisdiction: { $in: [input.jurisdiction, 'AU', 'Cth', 'Global'].filter(Boolean) },
  issueTypes: { $in: [...input.issueTypes, 'general_support'] },
  $or: [
    { resourceType: { $in: input.matchedResourceTypes } },
    { safetyRiskLevels: { $in: [input.riskLevel, 'all'] } }
  ]
});

const toSupportIssueTypes = (
  relatedIssueTypes: string[],
  fallbackCategory: ConversationFlowCategory
): ConversationFlowCategory[] => {
  const supportedCategories = relatedIssueTypes.filter(
    (item): item is ConversationFlowCategory =>
      CONVERSATION_FLOW_CATEGORIES.includes(item as ConversationFlowCategory)
  );

  return supportedCategories.length > 0
    ? Array.from(new Set([...supportedCategories, fallbackCategory]))
    : [fallbackCategory];
};

const toStructuredFactsRecord = (
  value: unknown
): ConversationFlowStructuredFacts => {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    privacyDataBreach: Boolean(record.privacyDataBreach),
    identityTheftRisk: Boolean(record.identityTheftRisk),
    scamFraud: Boolean(record.scamFraud),
    imageBasedAbuse: Boolean(record.imageBasedAbuse),
    onlineThreatBlackmail: Boolean(record.onlineThreatBlackmail),
    employerHealthPrivacy: Boolean(record.employerHealthPrivacy),
    workplaceBullying: Boolean(record.workplaceBullying),
    workplaceContext: Boolean(record.workplaceContext),
    racismDiscrimination: Boolean(record.racismDiscrimination),
    domesticViolence: Boolean(record.domesticViolence),
    physicalViolence: Boolean(record.physicalViolence),
    threatsPresent: Boolean(record.threatsPresent),
    immediateDanger: Boolean(record.immediateDanger),
    evidenceAvailable: Boolean(record.evidenceAvailable),
    domesticFamilyContext: Boolean(record.domesticFamilyContext),
    coerciveControl: Boolean(record.coerciveControl),
    blackmailOrExtortion: Boolean(record.blackmailOrExtortion),
    privatePhotosOrMessages: Boolean(record.privatePhotosOrMessages),
    personalDataLeak: Boolean(record.personalDataLeak),
    companyOrOrganisationInvolved: Boolean(record.companyOrOrganisationInvolved),
    employerInvolved: Boolean(record.employerInvolved),
    healthInformation: Boolean(record.healthInformation),
    identityDocumentsExposed: Boolean(record.identityDocumentsExposed),
    bankDetailsExposed: Boolean(record.bankDetailsExposed),
    moneyLost: Boolean(record.moneyLost),
    protectedAttribute: Boolean(record.protectedAttribute),
    schoolContext: Boolean(record.schoolContext),
    workplaceDiscrimination: Boolean(record.workplaceDiscrimination),
    housingOrServiceContext: Boolean(record.housingOrServiceContext),
    elderOrVulnerablePerson: Boolean(record.elderOrVulnerablePerson),
    migrationOrVisaThreat: Boolean(record.migrationOrVisaThreat),
    languageOrInterpreterNeed: Boolean(record.languageOrInterpreterNeed),
    selfHarmOrSuicidal: Boolean(record.selfHarmOrSuicidal),
    matchedFacts: Array.isArray(record.matchedFacts)
      ? record.matchedFacts
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      : [],
    organisations: Array.isArray(record.organisations)
      ? record.organisations
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      : [],
    platforms: Array.isArray(record.platforms)
      ? record.platforms
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      : [],
    protectedAttributes: Array.isArray(record.protectedAttributes)
      ? record.protectedAttributes
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      : [],
    jurisdiction: typeof record.jurisdiction === 'string' ? record.jurisdiction : undefined
  };
};

const toRelatedIssueTypes = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean)
        )
      )
    : [];

const decorateConversationFlowTriage = (
  triage:
    | (Record<string, unknown> & {
        likelyCategory: ConversationFlowCategory;
        confidenceScore: number;
        safetyRiskLevel: ConversationFlowRiskLevel;
      })
    | null
) => {
  if (!triage) {
    return null;
  }

  const structuredFacts = toStructuredFactsRecord(triage.structuredFacts);
  const likelyCategoryLabel = buildConversationFlowCategoryLabel(
    triage.likelyCategory,
    structuredFacts
  );
  const presentation = buildConversationFlowPresentation({
    category: triage.likelyCategory,
    facts: structuredFacts,
    riskLevel: triage.safetyRiskLevel,
    label: likelyCategoryLabel
  });
  const relatedIssueTypes = toRelatedIssueTypes(triage.relatedIssueTypes);

  return {
    ...triage,
    likelyCategoryLabel,
    confidenceLabel:
      triage.confidenceScore >= 0.75 ? 'high' : triage.confidenceScore >= 0.5 ? 'medium' : 'low',
    structuredFacts,
    relatedIssueTypes,
    presentation,
    disclaimer: 'This is information only, not legal advice.'
  };
};

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

export const buildSuggestedMicroCardTitles = (triage: {
  likelyCategory: ConversationFlowCategory;
  safetyRiskLevel: ConversationFlowRiskLevel;
  structuredFacts?: unknown;
}): string[] => {
  const facts = toStructuredFactsRecord(triage.structuredFacts);
  const titles: string[] = [];
  const addTitle = (title: string, condition: boolean) => {
    if (condition && !titles.includes(title)) {
      titles.push(title);
    }
  };

  addTitle('Domestic Violence Safety Planning', facts.domesticViolence);
  addTitle('Migration or Visa Pressure', facts.migrationOrVisaThreat);
  addTitle('Image-Based Abuse and Private Photos', facts.imageBasedAbuse || facts.privatePhotosOrMessages);
  addTitle('Online Blackmail or Threats', facts.onlineThreatBlackmail || facts.blackmailOrExtortion);
  addTitle('Protect Your Identity After a Scam', facts.scamFraud || facts.identityTheftRisk);
  addTitle('Elder Scam and Identity Safety', facts.elderOrVulnerablePerson && (facts.scamFraud || facts.identityTheftRisk));
  addTitle('What to Do After a Data Breach', facts.privacyDataBreach || facts.personalDataLeak);
  addTitle(
    'Saving Evidence Safely',
    facts.evidenceAvailable &&
      !(
        facts.domesticViolence &&
        (triage.safetyRiskLevel === 'high' || triage.safetyRiskLevel === 'immediate')
      )
  );
  addTitle('Privacy Complaint Steps', facts.privacyDataBreach || facts.employerHealthPrivacy);
  addTitle('Employer Sharing Health Information', facts.employerHealthPrivacy);
  addTitle('Workplace Bullying: Keep a Clear Record', facts.workplaceBullying);
  addTitle('Workplace Discrimination and Fair Treatment', facts.workplaceDiscrimination);
  addTitle('Racial Abuse or Hate Speech', facts.racismDiscrimination);
  addTitle('School Bullying or School Racism', facts.schoolContext);
  addTitle('Reporting Harmful Content to a Platform or eSafety', facts.platforms.length > 0 || triage.likelyCategory === 'online_abuse');
  addTitle('Interpreter and Language Support', facts.languageOrInterpreterNeed);

  return titles.slice(0, 7);
};

const getSuggestedMicroCardIds = async (triage: {
  likelyCategory: ConversationFlowCategory;
  safetyRiskLevel: ConversationFlowRiskLevel;
  reasoningSummary: string;
  matchedResourceTypes: string[];
  missingInformation: string[];
  matchedKnowledgeSources: Array<Record<string, unknown>>;
  structuredFacts?: unknown;
}) => {
  const suggestedTitles = buildSuggestedMicroCardTitles(triage);

  if (suggestedTitles.length === 0) {
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
  const cardsByTitle = new Map(
    cards.map((card) => [card.title.trim().toLowerCase(), card._id.toString()] as const)
  );

  return suggestedTitles
    .map((title) => cardsByTitle.get(title.toLowerCase()))
    .filter((value): value is string => Boolean(value))
    .slice(0, 6);
};

type TriageSupportActionSlot =
  | 'immediateDanger'
  | 'primarySupport'
  | 'secondarySupport'
  | 'additional';

type TriageSupportActionRecord = {
  slot: TriageSupportActionSlot;
  serviceId?: string;
  resourceType?: string;
  title: string;
  description: string;
  whySuggested: string;
  ctaLabel: string;
  href: string;
  phone?: string;
  websiteUrl?: string;
  actionKind: 'call' | 'external_link';
  consentNote: string;
};

type TriageSupportResourceTemplate = Omit<
  TriageSupportActionRecord,
  'slot' | 'whySuggested' | 'serviceId'
> & { id: string };

const TRIAGE_SUPPORT_RESOURCE_LIBRARY: Record<string, TriageSupportResourceTemplate> = {
  emergency_000: {
    id: 'emergency_000',
    resourceType: 'emergency',
    title: 'Emergency services (000)',
    description: 'Use 000 if there is immediate danger, serious threats, or someone may act now.',
    ctaLabel: 'Call 000',
    href: 'tel:000',
    phone: '000',
    actionKind: 'call',
    consentNote: 'SafeSpeak does not call or contact emergency services for you.'
  },
  respect_1800: {
    id: 'respect_1800',
    resourceType: 'domestic_violence_agency',
    title: '1800RESPECT',
    description: 'Confidential domestic, family, and sexual violence support, including safety planning.',
    ctaLabel: 'Call 1800RESPECT',
    href: 'tel:1800737732',
    phone: '1800 737 732',
    websiteUrl: 'https://www.1800respect.org.au',
    actionKind: 'call',
    consentNote: 'SafeSpeak will not share your details with 1800RESPECT unless you choose to contact them.'
  },
  lifeline: {
    id: 'lifeline',
    resourceType: 'mental_health',
    title: 'Lifeline',
    description: '24/7 crisis support if you are overwhelmed or having thoughts of self-harm.',
    ctaLabel: 'Call Lifeline',
    href: 'tel:131114',
    phone: '13 11 14',
    websiteUrl: 'https://www.lifeline.org.au',
    actionKind: 'call',
    consentNote: 'SafeSpeak does not call Lifeline for you.'
  },
  esafety: {
    id: 'esafety',
    resourceType: 'online_safety',
    title: 'eSafety Commissioner',
    description: 'Official reporting guidance for serious online abuse, image-based abuse, and harmful content.',
    ctaLabel: 'Open eSafety guidance',
    href: 'https://www.esafety.gov.au/report',
    websiteUrl: 'https://www.esafety.gov.au/report',
    actionKind: 'external_link',
    consentNote: 'Opening the link does not send anything from SafeSpeak.'
  },
  reportcyber: {
    id: 'reportcyber',
    resourceType: 'scam_support',
    title: 'ReportCyber',
    description: 'Official cybercrime reporting and recovery guidance for account compromise, identity theft, and online fraud.',
    ctaLabel: 'Open ReportCyber',
    href: 'https://www.cyber.gov.au/report-and-recover',
    websiteUrl: 'https://www.cyber.gov.au/report-and-recover',
    actionKind: 'external_link',
    consentNote: 'Opening the link does not submit a report from SafeSpeak.'
  },
  scamwatch: {
    id: 'scamwatch',
    resourceType: 'scam_support',
    title: 'Scamwatch',
    description: 'Scam reporting and awareness guidance that helps track scam patterns in Australia.',
    ctaLabel: 'Open Scamwatch',
    href: 'https://portal.scamwatch.gov.au/report-a-scam/',
    websiteUrl: 'https://portal.scamwatch.gov.au/report-a-scam/',
    actionKind: 'external_link',
    consentNote: 'Opening the link does not send your SafeSpeak details anywhere.'
  },
  oaic: {
    id: 'oaic',
    resourceType: 'government',
    title: 'OAIC privacy complaints',
    description: 'Official privacy complaint guidance for mishandled personal information and some data breaches.',
    ctaLabel: 'Open OAIC privacy guidance',
    href: 'https://www.oaic.gov.au/privacy/privacy-complaints',
    websiteUrl: 'https://www.oaic.gov.au/privacy/privacy-complaints',
    actionKind: 'external_link',
    consentNote: 'SafeSpeak will not lodge a privacy complaint for you.'
  },
  fair_work: {
    id: 'fair_work',
    resourceType: 'workplace_body',
    title: 'Fair Work workplace bullying guidance',
    description: 'Official workplace bullying guidance, including information about stop-bullying applications.',
    ctaLabel: 'Open Fair Work guidance',
    href: 'https://www.fairwork.gov.au/employment-conditions/bullying-sexual-harassment-and-discrimination-at-work/bullying-in-the-workplace',
    websiteUrl:
      'https://www.fairwork.gov.au/employment-conditions/bullying-sexual-harassment-and-discrimination-at-work/bullying-in-the-workplace',
    actionKind: 'external_link',
    consentNote: 'SafeSpeak does not contact Fair Work for you.'
  },
  ahrc: {
    id: 'ahrc',
    resourceType: 'anti_discrimination_body',
    title: 'Australian Human Rights Commission',
    description: 'Official discrimination complaint guidance for race and other protected attribute issues.',
    ctaLabel: 'Open AHRC complaints guidance',
    href: 'https://humanrights.gov.au/complaints/make-complaint',
    websiteUrl: 'https://humanrights.gov.au/complaints/make-complaint',
    actionKind: 'external_link',
    consentNote: 'Opening the link does not file a complaint from SafeSpeak.'
  },
  adnsw: {
    id: 'adnsw',
    resourceType: 'anti_discrimination_body',
    title: 'Anti-Discrimination NSW',
    description: 'Official NSW discrimination complaint guidance for racism, vilification, and other discrimination concerns.',
    ctaLabel: 'Open Anti-Discrimination NSW',
    href: 'https://antidiscrimination.nsw.gov.au/complaints.html',
    websiteUrl: 'https://antidiscrimination.nsw.gov.au/complaints.html',
    actionKind: 'external_link',
    consentNote: 'SafeSpeak does not send a complaint to Anti-Discrimination NSW for you.'
  },
  legal_aid_nsw: {
    id: 'legal_aid_nsw',
    resourceType: 'legal',
    title: 'Legal Aid NSW',
    description: 'Legal information and referral help if you want advice about rights or options.',
    ctaLabel: 'Open Legal Aid NSW',
    href: 'https://www.legalaid.nsw.gov.au/contact-us',
    websiteUrl: 'https://www.legalaid.nsw.gov.au/contact-us',
    phone: '1300 888 529',
    actionKind: 'external_link',
    consentNote: 'SafeSpeak information is not legal advice and does not contact Legal Aid for you.'
  },
  home_affairs_visa_scams: {
    id: 'home_affairs_visa_scams',
    resourceType: 'government',
    title: 'Home Affairs visa scam guidance',
    description: 'Official guidance on spotting visa scams and avoiding fake migration services.',
    ctaLabel: 'Open visa scam guidance',
    href: 'https://immi.homeaffairs.gov.au/help-support/visa-scams',
    websiteUrl: 'https://immi.homeaffairs.gov.au/help-support/visa-scams',
    actionKind: 'external_link',
    consentNote: 'Opening the link does not report anything automatically.'
  },
  omara: {
    id: 'omara',
    resourceType: 'government',
    title: 'OMARA registered agent search',
    description: 'Check whether a migration agent is officially registered before paying or sharing documents.',
    ctaLabel: 'Check an agent',
    href: 'https://portal.mara.gov.au/search-the-register-of-migration-agents/',
    websiteUrl: 'https://portal.mara.gov.au/search-the-register-of-migration-agents/',
    actionKind: 'external_link',
    consentNote: 'SafeSpeak does not verify an agent for you.'
  },
  elder_support: {
    id: 'elder_support',
    resourceType: 'council_support',
    title: 'Elder support line',
    description: 'Official elder abuse and support information for older people and the people helping them.',
    ctaLabel: 'Open elder support',
    href: 'https://www.health.gov.au/contacts/elder-abuse-phone-line',
    websiteUrl: 'https://www.health.gov.au/contacts/elder-abuse-phone-line',
    phone: '1800 353 374',
    actionKind: 'external_link',
    consentNote: 'SafeSpeak does not contact the elder support line for you.'
  },
  tis_national: {
    id: 'tis_national',
    resourceType: 'government',
    title: 'TIS National',
    description: 'Immediate phone interpreting support if you need help speaking with a service in English.',
    ctaLabel: 'Call TIS National',
    href: 'tel:131450',
    phone: '131 450',
    websiteUrl: 'https://www.tisnational.gov.au/en/Our-services/Language-services/Phone-interpreting',
    actionKind: 'call',
    consentNote: 'SafeSpeak does not place the interpreter call for you.'
  }
};

const createSupportAction = (
  slot: TriageSupportActionSlot,
  template: TriageSupportResourceTemplate,
  whySuggested: string,
  recommendation?: ReturnType<typeof toRecommendationRecord>
): TriageSupportActionRecord => ({
  slot,
  serviceId: recommendation?.id ?? template.id,
  resourceType: recommendation?.resourceType ?? template.resourceType,
  title: recommendation?.title || template.title,
  description: recommendation?.description || template.description,
  whySuggested,
  ctaLabel: recommendation?.ctaLabel || template.ctaLabel,
  href: recommendation?.phone
    ? `tel:${recommendation.phone.replace(/\s+/g, '')}`
    : recommendation?.websiteUrl || template.href,
  phone: recommendation?.phone || template.phone,
  websiteUrl: recommendation?.websiteUrl || template.websiteUrl,
  actionKind: recommendation?.phone ? 'call' : template.actionKind,
  consentNote: template.consentNote
});

const recommendationMatches = (
  recommendation: ReturnType<typeof toRecommendationRecord>,
  pattern: RegExp,
  resourceTypes: string[] = []
) =>
  pattern.test(recommendation.title) ||
  pattern.test(recommendation.description) ||
  (resourceTypes.length > 0 && resourceTypes.includes(recommendation.resourceType));

export const buildSupportResourceSuggestions = (input: {
  category: ConversationFlowCategory;
  facts: ConversationFlowStructuredFacts;
  riskLevel: ConversationFlowRiskLevel;
  jurisdiction?: string;
  recommendations?: Array<ReturnType<typeof toRecommendationRecord>>;
}): TriageSupportActionRecord[] => {
  const suggestions: TriageSupportActionRecord[] = [];
  const recommendations = input.recommendations ?? [];
  const addSuggestion = (
    slot: TriageSupportActionSlot,
    templateKey: keyof typeof TRIAGE_SUPPORT_RESOURCE_LIBRARY,
    whySuggested: string,
    matcher?: (recommendation: ReturnType<typeof toRecommendationRecord>) => boolean
  ) => {
    const existing = suggestions.find((item) => item.title === TRIAGE_SUPPORT_RESOURCE_LIBRARY[templateKey].title);

    if (existing) {
      return;
    }

    const recommendation = matcher ? recommendations.find(matcher) : undefined;
    suggestions.push(
      createSupportAction(slot, TRIAGE_SUPPORT_RESOURCE_LIBRARY[templateKey], whySuggested, recommendation)
    );
  };

  if (input.facts.immediateDanger || input.riskLevel === 'immediate') {
    addSuggestion(
      'immediateDanger',
      'emergency_000',
      'Suggested because the triage picked up immediate danger or a serious threat.'
    );
  }

  if (input.facts.domesticViolence) {
    addSuggestion(
      'primarySupport',
      'respect_1800',
      'Suggested because domestic, family, or coercive-control indicators were detected.',
      (recommendation) =>
        recommendationMatches(recommendation, /1800respect/i, ['domestic_violence_agency'])
    );
  }

  if (input.facts.selfHarmOrSuicidal || input.category === 'mental_health_distress') {
    addSuggestion(
      'secondarySupport',
      'lifeline',
      'Suggested because crisis or self-harm language was detected.',
      (recommendation) => recommendationMatches(recommendation, /lifeline/i, ['mental_health'])
    );
  }

  if (
    input.category === 'online_abuse' ||
    input.facts.imageBasedAbuse ||
    input.facts.onlineThreatBlackmail ||
    (input.facts.platforms.length > 0 &&
      (input.facts.threatsPresent || input.facts.racismDiscrimination))
  ) {
    addSuggestion(
      'additional',
      'esafety',
      'Suggested because the triage picked up online abuse, image-based abuse, or harmful content concerns.',
      (recommendation) =>
        recommendationMatches(recommendation, /esafety/i, ['online_safety'])
    );
  }

  if (input.facts.scamFraud || input.facts.identityTheftRisk) {
    addSuggestion(
      'additional',
      'reportcyber',
      'Suggested because the triage picked up account compromise, identity risk, or cybercrime concerns.',
      (recommendation) =>
        recommendationMatches(recommendation, /reportcyber/i, ['scam_support', 'online_safety'])
    );
    addSuggestion(
      'additional',
      'scamwatch',
      'Suggested because the triage picked up a scam or fraud pattern.',
      (recommendation) =>
        recommendationMatches(recommendation, /scamwatch/i, ['scam_support'])
    );
  }

  if (input.facts.privacyDataBreach || input.facts.employerHealthPrivacy) {
    addSuggestion(
      'additional',
      'oaic',
      'Suggested because the triage picked up privacy, personal information, or data-breach concerns.'
    );
  }

  if (input.facts.workplaceBullying || input.facts.workplaceDiscrimination) {
    addSuggestion(
      'additional',
      'fair_work',
      'Suggested because the triage picked up a workplace bullying or rights issue.',
      (recommendation) =>
        recommendationMatches(recommendation, /fair work/i, ['workplace_body'])
    );
  }

  if (input.facts.racismDiscrimination || input.facts.workplaceDiscrimination) {
    addSuggestion(
      'additional',
      input.jurisdiction === 'NSW' ? 'adnsw' : 'ahrc',
      'Suggested because the triage picked up racism, hate-based abuse, or discrimination concerns.',
      (recommendation) =>
        recommendationMatches(recommendation, /anti-discrimination|human rights/i, ['anti_discrimination_body'])
    );
  }

  if (
    input.facts.workplaceDiscrimination ||
    input.facts.domesticViolence ||
    input.facts.migrationOrVisaThreat ||
    input.facts.racismDiscrimination
  ) {
    addSuggestion(
      'additional',
      'legal_aid_nsw',
      'Suggested because you may want formal rights information or a referral, not because SafeSpeak is giving legal advice.',
      (recommendation) => recommendationMatches(recommendation, /legal aid/i, ['legal'])
    );
  }

  if (input.facts.migrationOrVisaThreat) {
    addSuggestion(
      'additional',
      'home_affairs_visa_scams',
      'Suggested because the triage picked up a fake migration, visa, or immigration-pressure pattern.'
    );
    addSuggestion(
      'additional',
      'omara',
      'Suggested because checking whether an agent is registered can help with migration-related scam concerns.'
    );
  }

  if (input.facts.elderOrVulnerablePerson) {
    addSuggestion(
      'additional',
      'elder_support',
      'Suggested because an older or vulnerable person may be affected by the incident.',
      (recommendation) => recommendationMatches(recommendation, /elder/i, ['council_support'])
    );
  }

  if (input.facts.languageOrInterpreterNeed) {
    addSuggestion(
      'additional',
      'tis_national',
      'Suggested because language or interpreter support may help when contacting a service.'
    );
  }

  return suggestions;
};

const buildFallbackSupportRecommendations = (input: {
  category: ConversationFlowCategory;
  facts: ConversationFlowStructuredFacts;
  riskLevel: ConversationFlowRiskLevel;
  jurisdiction?: string;
}): Array<ReturnType<typeof toRecommendationRecord>> =>
  buildSupportResourceSuggestions({
    category: input.category,
    facts: input.facts,
    riskLevel: input.riskLevel,
    jurisdiction: input.jurisdiction
  }).map((suggestion, index) => ({
    id: suggestion.serviceId ?? suggestion.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: suggestion.title,
    description: suggestion.description,
    category: input.category,
    resourceType: suggestion.resourceType ?? 'government',
    ctaLabel: suggestion.ctaLabel,
    phone: suggestion.phone,
    email: undefined,
    websiteUrl: suggestion.websiteUrl ?? suggestion.href,
    priority: 100 - index,
    jurisdiction: input.jurisdiction,
    safetyNotes: suggestion.whySuggested,
    eligibilityNotes: suggestion.consentNote,
    languageSupportNotes: input.facts.languageOrInterpreterNeed
      ? 'Ask for an interpreter or language support if you need one.'
      : undefined,
    active: true
  }));

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

const buildTriageForSession = async (
  session: HydratedConversationFlowSessionDocument,
  options: { finalizeSession?: boolean } = {}
) => {
  const messages = await ConversationFlowMessageModel.find({
    conversationSessionId: session._id
  })
    .sort({ turnNumber: 1 })
    .lean();
  const facts = await ConversationFlowFactsModel.findOne({
    conversationSessionId: session._id
  }).lean();
  const combinedText = messages.map((message) => message.content).join('\n');
  const structuredFacts = extractStructuredTriageFacts({
    text: `${combinedText}\n${JSON.stringify(facts?.timeline ?? {})}`,
    facts: facts ?? {},
    jurisdiction: session.jurisdiction
  });
  const categoryDetection = detectCategory({
    text: `${combinedText}\n${JSON.stringify(facts?.timeline ?? {})}`,
    selectedTopic: session.selectedTopic,
    structuredFacts
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
  const hasActionableCategory =
    categoryDetection.category !== 'general_support' &&
    categoryDetection.confidenceScore >= ACTIONABLE_TRIAGE_CONFIDENCE_THRESHOLD &&
    categoryDetection.evidenceScore > 0;
  const canProceedToRecommendations =
    hasActionableCategory &&
    Boolean(facts?.whatHappened) &&
    Boolean(
      facts?.peopleInvolved || facts?.whereHappened || facts?.whenHappened || facts?.safetyConcerns
    );
  const humanReviewRecommended =
    !canProceedToRecommendations ||
    knowledgeMatch.matchedLegislationIds.length === 0 ||
    categoryDetection.confidenceScore < 0.6;
  const reasoningSummary = buildReasoningSummary({
    category: categoryDetection.category,
    riskLevel,
    facts: facts ?? {},
    structuredFacts,
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
        structuredFacts,
        matchedLegislationIds: knowledgeMatch.matchedLegislationIds,
        matchedKnowledgeSources: knowledgeMatch.matchedKnowledgeSources,
        humanReviewRecommended,
        missingInformation,
        canProceedToRecommendations,
        matchedResourceTypes: categoryDetection.matchedResourceTypes,
        relatedIssueTypes: categoryDetection.relatedIssueTypes
      }
    },
    { new: true, upsert: true }
  ).lean();

  session.detectedCategory = triage.likelyCategory;
  session.safetyRiskLevel = triage.safetyRiskLevel;
  if (options.finalizeSession && canProceedToRecommendations) {
    session.status = 'triaged';
  }
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
    triage: decorateConversationFlowTriage(triage)
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
  const triageHandoffIntent = detectTriageHandoffIntent(input.content);

  let assistantPayload: Record<string, unknown>;

  if (triageHandoffIntent) {
    assistantPayload = buildTriageHandoffAssistantPayload();
  } else {
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
  const enoughContextForTriageAssessment = hasEnoughContextForTriageAssessment(
    session,
    normalizedTimeline
  );
  const triage = enoughContextForTriageAssessment ? await buildTriageForSession(session) : null;
  const offerTriage =
    triageHandoffIntent || Boolean(triage && !shouldBlockTriage(triage));

  if (offerTriage && !session.triageOfferedAt) {
    session.triageOfferedAt = new Date();
    session.status = 'ready_for_triage';
  } else if (offerTriage) {
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
    triage: decorateConversationFlowTriage(triage),
    transition: {
      offerTriage,
      prompt: triageHandoffIntent
        ? null
        : offerTriage
        ? 'I am sorry this happened to you. You are safe to explore your options here. Would you like help understanding reporting options, support services, evidence, or your rights?'
        : enoughContextForTriageAssessment
          ? 'Based on what you shared so far, this does not appear to fit the harm, safety, scam, violence, harassment, or discrimination categories that move to triage here. You can keep chatting if there is more context.'
          : null,
      primaryCta: offerTriage ? 'Continue to Triage' : null,
      secondaryCta: offerTriage ? 'Review my options' : null
    },
    responseMeta: buildConversationAssistantResponseMeta({
      assistantPayload,
      conversationSessionId,
      offerTriage
    })
  };
};

export const getConversationFlowTriage = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const triage = await buildTriageForSession(session, { finalizeSession: true });

  await audit(context, CONVERSATION_FLOW_ACTIONS.triageGet, conversationSessionId, {
    likelyCategory: triage.likelyCategory
  });

  return {
    session: toSessionRecord(session),
    triage: decorateConversationFlowTriage(triage)
  };
};

export const getConversationFlowSupport = async (
  context: ConversationFlowContext,
  conversationSessionId: string
) => {
  const session = await getOwnedConversationSession(context, conversationSessionId);
  const triage = await buildTriageForSession(session, { finalizeSession: true });
  const relatedIssueTypes = toRelatedIssueTypes(triage.relatedIssueTypes);
  const supportIssueTypes = toSupportIssueTypes(relatedIssueTypes, triage.likelyCategory);
  const structuredFacts = toStructuredFactsRecord(triage.structuredFacts);
  const recommendationDocs = await SupportServiceModel.find(
    buildRecommendationsFilter({
      issueTypes: supportIssueTypes,
      riskLevel: triage.safetyRiskLevel,
      matchedResourceTypes: triage.matchedResourceTypes,
      jurisdiction: session.jurisdiction
    })
  )
    .sort({ priority: -1, sortOrder: 1, name: 1 })
    .limit(8)
    .lean();
  const fallbackUsed = recommendationDocs.length === 0;
  const recommendations = fallbackUsed
    ? buildFallbackSupportRecommendations({
        category: triage.likelyCategory,
        facts: structuredFacts,
        riskLevel: triage.safetyRiskLevel,
        jurisdiction: session.jurisdiction
      })
    : recommendationDocs.map((item) =>
        toRecommendationRecord(
          item as Record<string, unknown> & { _id?: { toString: () => string } },
          triage.likelyCategory
        )
      );
  const supportSuggestions = buildSupportResourceSuggestions({
    category: triage.likelyCategory,
    facts: structuredFacts,
    riskLevel: triage.safetyRiskLevel,
    jurisdiction: session.jurisdiction,
    recommendations
  });
  const suggestedMicroCardIds = await getSuggestedMicroCardIds({
    likelyCategory: triage.likelyCategory,
    safetyRiskLevel: triage.safetyRiskLevel,
    reasoningSummary: triage.reasoningSummary,
    matchedResourceTypes: triage.matchedResourceTypes,
    missingInformation: triage.missingInformation,
    matchedKnowledgeSources: toRecordArray(triage.matchedKnowledgeSources),
    structuredFacts: triage.structuredFacts
  });

  await audit(context, CONVERSATION_FLOW_ACTIONS.supportGet, conversationSessionId, {
    likelyCategory: triage.likelyCategory,
    suggestedMicroCardCount: suggestedMicroCardIds.length,
    recommendationCount: recommendations.length
  });

  return {
    session: toSessionRecord(session),
    triage: decorateConversationFlowTriage(triage),
    support: {
      suggestedMicroCardIds,
      recommendedActions: supportSuggestions.filter((item) => item.slot !== 'additional').slice(0, 3),
      additionalResources: supportSuggestions.filter((item) => item.slot === 'additional').slice(0, 6),
      matchedSupportServices: recommendations,
      fallbackUsed
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
  const recommendationIssueTypes = toSupportIssueTypes(
    toRelatedIssueTypes(triageRecord.relatedIssueTypes),
    triageRecord.likelyCategory
  );
  const structuredFacts = toStructuredFactsRecord(triageRecord.structuredFacts);
  const recommendationDocs = await SupportServiceModel.find(
    buildRecommendationsFilter({
      issueTypes: recommendationIssueTypes,
      riskLevel: triageRecord.safetyRiskLevel,
      matchedResourceTypes: triageRecord.matchedResourceTypes,
      jurisdiction: session.jurisdiction
    })
  )
    .sort({ priority: -1, sortOrder: 1, name: 1 })
    .limit(8)
    .lean();
  const fallbackUsed = recommendationDocs.length === 0;
  const recommendations = fallbackUsed
    ? buildFallbackSupportRecommendations({
        category: triageRecord.likelyCategory,
        facts: structuredFacts,
        riskLevel: triageRecord.safetyRiskLevel,
        jurisdiction: session.jurisdiction
      })
    : recommendationDocs.map((item) =>
        toRecommendationRecord(
          item as Record<string, unknown> & { _id?: { toString: () => string } },
          triageRecord.likelyCategory
        )
      );

  session.status = triageRecord.canProceedToRecommendations
    ? 'recommendation_ready'
    : session.status;
  await session.save();

  await audit(context, CONVERSATION_FLOW_ACTIONS.recommendationsGet, conversationSessionId, {
    count: recommendations.length
  });

  return {
    session: toSessionRecord(session),
    recommendations,
    fallbackUsed
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
      categoryLabel: buildConversationFlowCategoryLabel(
        triageRecord.likelyCategory,
        toStructuredFactsRecord(triageRecord.structuredFacts)
      ),
      safetyRiskLevel: triageRecord.safetyRiskLevel,
      matchedKnowledgeSources: triageRecord.matchedKnowledgeSources,
      matchedLegislationIds: triageRecord.matchedLegislationIds,
      humanReviewRecommended: triageRecord.humanReviewRecommended,
      sections,
      disclaimer: 'This is information only, not legal advice.'
    }
  };
};
