import { StatusCodes } from 'http-status-codes';
import { Types, type HydratedDocument } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';
import type { MicroEducationChip } from '@modules/microeducation/microeducation.types';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import { runTimelineAssistant } from '@modules/rag/rag.service';
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
  matchedFacts: string[];
  organisations: string[];
  platforms: string[];
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
  definitions
    .filter((definition) => definition.pattern.test(text))
    .map((definition) => definition.label);

const extractPrivacyIssueDescriptions = (facts: ConversationFlowStructuredFacts): string[] => {
  const issues: string[] = [];

  if (facts.imageBasedAbuse) {
    issues.push('private photos or intimate content being shared without permission');
  }

  if (facts.onlineThreatBlackmail) {
    issues.push('online threats or blackmail');
  }

  if (facts.privacyDataBreach) {
    issues.push('privacy or data exposure');
  }

  if (facts.identityTheftRisk || facts.scamFraud) {
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

  if (facts.scamFraud) {
    matchedFacts.push('scam/fraud');
  }

  if (facts.imageBasedAbuse) {
    matchedFacts.push('image-based abuse/private photos');
  }

  if (facts.onlineThreatBlackmail) {
    matchedFacts.push('online threat/blackmail');
  }

  if (facts.employerHealthPrivacy) {
    matchedFacts.push('employer/shared health information');
  }

  if (facts.workplaceBullying) {
    matchedFacts.push('workplace bullying or harassment');
  }

  if (facts.domesticViolence) {
    matchedFacts.push('domestic violence');
  }

  if (facts.racismDiscrimination) {
    matchedFacts.push('racism/discrimination');
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

  if (facts.immediateDanger) {
    matchedFacts.push('immediate danger');
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
  const workplaceContext =
    /\b(employer|manager|supervisor|coworker|co-worker|colleague|hr|human resources|workplace|at work|office)\b/i.test(
      combinedText
    );
  const employerHealthPrivacy =
    workplaceContext &&
    /\b(health information|medical information|medical details|health details)\b/i.test(
      combinedText
    ) &&
    /\b(shared|disclosed|told|sent|leaked|exposed|revealed)\b/i.test(combinedText);
  const organisations = extractNamedMatches(combinedText, [
    { label: 'company', pattern: /\bcompany\b/i },
    { label: 'employer', pattern: /\bemployer\b/i },
    { label: 'bank', pattern: /\bbank\b/i },
    { label: 'workplace', pattern: /\bworkplace\b/i },
    { label: 'school', pattern: /\bschool\b/i },
    { label: 'platform', pattern: /\bplatform\b/i }
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
    privacyDataBreach:
      /\b(data breach|privacy breach|personal details?.*(?:shared|leaked|exposed)|personal information.*(?:shared|leaked|exposed)|private information.*(?:shared|leaked|exposed)|details leaked|information leaked|doxx|doxed|doxxed|health information.*(?:shared|disclosed|leaked|exposed))\b/i.test(
        combinedText
      ) || employerHealthPrivacy,
    identityTheftRisk:
      /\b(identity theft|id\b|passport|driver'?s licen[cs]e|medicare|bank details?|account details?|credit card|debit card|date of birth|dob|tax file number)\b/i.test(
        combinedText
      ),
    scamFraud:
      /\b(scam|fraud|phishing|fake link|otp|one time code|one-time code|account hacked|stole my money|took my money|bank details?)\b/i.test(
        combinedText
      ),
    imageBasedAbuse:
      /\b(private photos?|intimate photos?|nudes?|explicit images?|image-based abuse|revenge porn|shared my photos?|publish my photos?|post my photos?)\b/i.test(
        combinedText
      ),
    onlineThreatBlackmail:
      /\b(threat(?:ened)? to publish|threat(?:ened)? to share|blackmail|extort|publish private messages?|share private messages?|leak private messages?|post private messages?)\b/i.test(
        combinedText
      ),
    employerHealthPrivacy,
    workplaceBullying:
      /\b(workplace bullying|bullying at work|manager humiliat|coworkers? harass|co-?workers? harass|workplace pressure|unsafe at work|boss .*harass|supervisor .*harass)\b/i.test(
        combinedText
      ),
    workplaceContext,
    racismDiscrimination:
      /\b(racist|racism|racial abuse|racial slur|discrimination|hate speech|vilification|because of my race|because i am muslim|because i am black|because of my skin|hijab|headscarf)\b/i.test(
        combinedText
      ),
    domesticViolence:
      /\b(domestic violence|family violence|family harm|coercive control)\b/i.test(combinedText) ||
      (/\b(partner|husband|wife|boyfriend|girlfriend|ex partner|ex-partner)\b/i.test(combinedText) &&
        /\b(hit|hurt|assault|slap|punch|kick|threat|threatened)\b/i.test(combinedText)),
    physicalViolence: /\b(hit|hurt|assault|slap|punch|kick|strangle|choke|beat)\b/i.test(
      combinedText
    ),
    threatsPresent:
      /\b(threat|threatened|blackmail|extort|publish|leak|expose|find me|come back|things will get worse)\b/i.test(
        combinedText
      ),
    immediateDanger:
      /\b(immediate danger|unsafe now|call 000|weapon|gun|shoot|shot|strangled|strangle|can.t breathe|kill me|kill him|kill her)\b/i.test(
        lowerCombinedText
      ),
    evidenceAvailable:
      /\b(screenshot|screenshots|message|messages|email|emails|photo|photos|recording|recordings|witness|witnesses|bank statement|receipt|receipts)\b/i.test(
        combinedText
      ) || Boolean(input.facts?.evidenceMentioned?.trim()),
    organisations,
    platforms,
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
): ConversationFlowCategory[] => {
  const relatedIssueTypes = new Set<ConversationFlowCategory>([category]);

  if (facts.scamFraud || facts.identityTheftRisk) {
    relatedIssueTypes.add('scam_fraud');
  }

  if (
    facts.privacyDataBreach ||
    facts.imageBasedAbuse ||
    facts.onlineThreatBlackmail ||
    facts.employerHealthPrivacy
  ) {
    relatedIssueTypes.add('online_abuse');
  }

  if (facts.workplaceBullying) {
    relatedIssueTypes.add('workplace_bullying');
  }

  if (facts.domesticViolence) {
    relatedIssueTypes.add('domestic_violence');
  }

  if (facts.racismDiscrimination) {
    relatedIssueTypes.add('racism_discrimination');
  }

  if (facts.threatsPresent || facts.imageBasedAbuse) {
    relatedIssueTypes.add('harassment');
  }

  return Array.from(relatedIssueTypes);
};

export const buildConversationFlowCategoryLabel = (
  category: ConversationFlowCategory,
  facts: ConversationFlowStructuredFacts
): string => {
  if (
    facts.employerHealthPrivacy &&
    !facts.workplaceBullying &&
    !facts.scamFraud &&
    !facts.imageBasedAbuse &&
    !facts.onlineThreatBlackmail
  ) {
    return 'Workplace Privacy Concern';
  }

  if (category === 'online_abuse') {
    if (facts.imageBasedAbuse && facts.onlineThreatBlackmail) {
      return 'Image-Based Abuse & Online Threat';
    }

    if (
      facts.privacyDataBreach &&
      (facts.onlineThreatBlackmail || facts.imageBasedAbuse || facts.employerHealthPrivacy)
    ) {
      return 'Privacy, Data Breach & Online Threat';
    }

    if (facts.privacyDataBreach || facts.identityTheftRisk || facts.scamFraud) {
      return 'Cyber Safety & Privacy';
    }
  }

  if (category === 'scam_fraud' && facts.identityTheftRisk) {
    return 'Scam & Identity Risk';
  }

  return categoryLabels[category];
};

const buildMatchedResourceTypesFromFacts = (
  category: ConversationFlowCategory,
  facts: ConversationFlowStructuredFacts
): string[] => {
  const resourceTypes = new Set<string>(['evidence_guidance', 'mental_health']);

  if (facts.immediateDanger) {
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

  if (facts.employerHealthPrivacy || facts.workplaceBullying) {
    resourceTypes.add('workplace_body');
    resourceTypes.add('legal');
    resourceTypes.add('government');
  }

  if (facts.racismDiscrimination) {
    resourceTypes.add('anti_discrimination_body');
    resourceTypes.add('government');
  }

  if (facts.domesticViolence) {
    resourceTypes.add('domestic_violence_agency');
    resourceTypes.add('safety_planning');
    resourceTypes.add('council_support');
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
      ? 'If you are in immediate danger or think someone may act now, call 000 immediately.'
      : input.facts.threatsPresent || input.riskLevel === 'high'
        ? 'If the threats escalate or you feel unsafe, put immediate safety first and consider calling 000.'
        : 'If you or someone else becomes unsafe, call 000 now. You can stop using SafeSpeak at any time.';

  if (input.category === 'domestic_violence') {
    return {
      title: 'Domestic or Family Violence Support',
      body:
        'From what you shared, this may involve domestic or family violence. You can focus on safety planning, support services, evidence steps, and reporting options at your pace.',
      assessmentNote,
      primaryStepTitle: 'Put safety first',
      primaryStepBody:
        'If it feels safe, think about where you can go, who you can contact, and what essentials or evidence you may need to keep with you.',
      immediateDangerBody,
      secondTitle: 'Confidential support',
      secondBody:
        'You can contact a specialist family violence service such as 1800RESPECT to talk through safety and options.',
      secondActionLabel: 'Get support',
      secondActionHref: '/dashboard/explorer',
      thirdTitle: 'Save evidence safely',
      thirdBody:
        'If it feels safe, keep messages, photos, dates, and notes somewhere the other person cannot access.',
      thirdActionLabel: 'Evidence steps',
      thirdActionHref: '/dashboard?view=reportsubmissionevidence',
      stepReasons: ['domestic violence indicators matched', 'safety risk elevated', 'evidence may matter'],
      microCardSummary: buildCardReasonSummary(input.facts)
    };
  }

  if (input.category === 'workplace_bullying' && input.facts.workplaceBullying) {
    return {
      title: 'Workplace Bullying Support',
      body:
        'From what you shared, this may involve bullying, harassment, or pressure at work. You can review workplace options, support, and safe evidence steps.',
      assessmentNote,
      primaryStepTitle: 'Record the pattern',
      primaryStepBody:
        'If it feels safe, keep dates, messages, witnesses, rosters, and notes about what happened and how often it happened.',
      immediateDangerBody,
      secondTitle: 'Review workplace options',
      secondBody:
        'You can review workplace, HR, union, regulator, or legal information pathways without making a report yet.',
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

  if (input.facts.employerHealthPrivacy && !input.facts.workplaceBullying && !input.facts.scamFraud) {
    return {
      title: 'Workplace Privacy Concern',
      body:
        'From what you shared, this may involve a workplace privacy concern, including health information being shared without permission. You can focus on evidence, internal answers, and privacy options without rushing.',
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
        'You can look at workplace, privacy, regulator, or legal information pathways, including complaint options where appropriate.',
      thirdActionLabel: 'Evidence steps',
      thirdActionHref: '/dashboard?view=reportsubmissionevidence',
      stepReasons: [
        'employer/shared health information matched',
        'no strong bullying pattern was detected',
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
      joinNaturalLanguageList(extractPrivacyIssueDescriptions(input.facts)) || 'privacy and cyber-safety issues';
    const secondBodySegments = [
      input.facts.imageBasedAbuse || input.facts.onlineThreatBlackmail
        ? 'You can report abusive content or threats to the platform or service involved.'
        : '',
      input.facts.privacyDataBreach
        ? 'You can ask the company or organisation what data was exposed, how it happened, and what they are doing about it.'
        : '',
      input.facts.employerHealthPrivacy
        ? 'If the issue involves an employer sharing health information, you can also ask what was shared and why.'
        : '',
      input.facts.privacyDataBreach || input.facts.employerHealthPrivacy
        ? 'It may also be worth considering OAIC or privacy complaint options where appropriate.'
        : ''
    ].filter(Boolean);

    return {
      title: `${label} Support`,
      body: `From what you shared, this may involve ${issueDescription}. You can focus on account protection, evidence, reporting options, and support without doing everything at once.`,
      assessmentNote,
      primaryStepTitle:
        input.facts.identityTheftRisk || input.facts.scamFraud
          ? 'Secure accounts, bank details, and identity information'
          : 'Protect your information and save evidence',
      primaryStepBody:
        input.facts.identityTheftRisk || input.facts.scamFraud
          ? 'If it feels safe, change passwords, contact your bank, watch for misuse of your identity details, and avoid sending more money, codes, or documents.'
          : 'If it feels safe, save screenshots, messages, dates, account details, and any other evidence in a private place.',
      immediateDangerBody,
      secondTitle:
        input.facts.imageBasedAbuse || input.facts.onlineThreatBlackmail
          ? 'Report the content and privacy issue'
          : 'Ask what was exposed and review privacy options',
      secondBody: secondBodySegments.join(' '),
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle:
        input.facts.employerHealthPrivacy
          ? 'Keep a clear record of the workplace privacy issue'
          : 'Get support while deciding next steps',
      thirdBody:
        input.facts.employerHealthPrivacy
          ? 'Keep a short timeline of who shared the information, who received it, and how the disclosure has affected you.'
          : 'If the threats, privacy breach, or scam are overwhelming, you can get emotional support while deciding what to do next.',
      thirdActionLabel:
        input.facts.employerHealthPrivacy || input.facts.evidenceAvailable
          ? 'Evidence steps'
          : 'Find support',
      thirdActionHref:
        input.facts.employerHealthPrivacy || input.facts.evidenceAvailable
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
    return {
      title: 'Racism or Discrimination Support',
      body:
        'From what you shared, this may involve racism or discrimination. You can look at support, reporting options, rights information, and evidence steps.',
      assessmentNote,
      primaryStepTitle: 'Save the details',
      primaryStepBody:
        'If it feels safe, keep screenshots, dates, locations, names, and notes in a private place.',
      immediateDangerBody,
      secondTitle: 'Review rights and reporting options',
      secondBody:
        'You can review options such as anti-discrimination bodies, police, community support, or legal information.',
      secondActionLabel: 'Review options',
      secondActionHref: '/dashboard?view=reportsubmissionrecommendations',
      thirdTitle: 'Get support',
      thirdBody:
        'You can reach out to a support service if the incident feels upsetting, isolating, or unsafe.',
      thirdActionLabel: 'Find support',
      thirdActionHref: '/dashboard/explorer',
      stepReasons: ['racism/discrimination indicators matched', 'rights and evidence pathways may be relevant'],
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
  relatedIssueTypes: ConversationFlowCategory[];
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
  const scores: Record<ConversationFlowCategory, number> = {
    domestic_violence:
      baseScores.domestic_violence +
      (structuredFacts.domesticViolence ? 6 : 0) +
      (structuredFacts.physicalViolence ? 2 : 0) +
      (structuredFacts.immediateDanger ? 2 : 0),
    workplace_bullying:
      baseScores.workplace_bullying +
      (structuredFacts.workplaceBullying ? 6 : 0) +
      (structuredFacts.workplaceContext ? 1 : 0) +
      (structuredFacts.employerHealthPrivacy ? 1 : 0) -
      (!structuredFacts.workplaceBullying && structuredFacts.employerHealthPrivacy ? 2.5 : 0),
    racism_discrimination:
      baseScores.racism_discrimination + (structuredFacts.racismDiscrimination ? 6 : 0),
    online_abuse:
      baseScores.online_abuse +
      (structuredFacts.imageBasedAbuse ? 5 : 0) +
      (structuredFacts.onlineThreatBlackmail ? 4 : 0) +
      (structuredFacts.privacyDataBreach ? 3 : 0) +
      (structuredFacts.employerHealthPrivacy ? 2 : 0) +
      (structuredFacts.platforms.length > 0 ? 1 : 0) +
      (structuredFacts.organisations.length > 0 ? 0.5 : 0) +
      (structuredFacts.threatsPresent ? 1 : 0),
    scam_fraud:
      baseScores.scam_fraud +
      (structuredFacts.scamFraud ? 5 : 0) +
      (structuredFacts.identityTheftRisk ? 4 : 0) +
      (structuredFacts.privacyDataBreach ? 1 : 0),
    theft_property: baseScores.theft_property,
    harassment:
      baseScores.harassment +
      (structuredFacts.threatsPresent ? 2 : 0) +
      (structuredFacts.imageBasedAbuse ? 1 : 0),
    mental_health_distress: baseScores.mental_health_distress,
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
    const fallbackCategory = selectedTopicFallbackCategory(input.selectedTopic);

    return {
      category: fallbackCategory,
      confidenceScore: input.selectedTopic ? 0.4 : 0.25,
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
  const confidenceScore = Math.min(
    0.95,
    0.34 +
      Math.min(best.score, 8) * 0.06 +
      Math.min(best.keywordScore, 3) * 0.04 +
      Math.max(best.score - runnerUpScore, 0) * 0.02
  );

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
    /\b(immediate danger|kill me|kill him|kill her|call 000|unsafe now|weapon|gun|shoot|shot|strangled|strangle|can.t breathe)\b/i.test(
      combined
    )
  ) {
    return 'immediate';
  }

  if (
    /\b(threat|hit|assault|injured|stalking|followed|find me|come back|things will get worse|scared to go home|afraid to go home)\b/i.test(
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

  if (issueDescription) {
    return `Based on what you shared so far, this looks most like ${categoryLabel.toLowerCase()}. I also picked up ${issueDescription}.${riskText}${missingText}`.trim();
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
    jurisdiction: typeof record.jurisdiction === 'string' ? record.jurisdiction : undefined
  };
};

const toRelatedIssueTypes = (value: unknown): ConversationFlowCategory[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ConversationFlowCategory =>
          typeof item === 'string' && CONVERSATION_FLOW_CATEGORIES.includes(item as ConversationFlowCategory)
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
  structuredFacts?: unknown;
}): MicroEducationSuggestionProfile | null => {
  const searchText = buildSupportSearchText(triage);
  const structuredFacts = toStructuredFactsRecord(triage.structuredFacts);
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
  let anchorPatterns: RegExp[] = [/\babuse\b/i, /\bviolence\b/i, /\bthreat/i, /\bharass/i];
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

  if (
    structuredFacts.privacyDataBreach ||
    structuredFacts.imageBasedAbuse ||
    structuredFacts.onlineThreatBlackmail ||
    structuredFacts.scamFraud ||
    structuredFacts.identityTheftRisk ||
    structuredFacts.employerHealthPrivacy
  ) {
    preferredChips = ['safety', 'rights', 'harassment', 'mentalHealth'];
    keywords = [
      'privacy',
      'data breach',
      'identity',
      'scam',
      'bank',
      'photo',
      'image',
      'blackmail',
      'evidence',
      'health information'
    ];
    anchorPatterns = [
      /\bprivacy\b/i,
      /\bdata breach\b/i,
      /\bidentity\b/i,
      /\bscam\b/i,
      /\bbank\b/i,
      /\bimage-based\b/i,
      /\bprivate photos?\b/i,
      /\bblackmail\b/i,
      /\bhealth information\b/i,
      /\bevidence\b/i
    ];
    bridgePatterns = [
      /\bonline safety\b/i,
      /\beSafety\b/i,
      /\bcomplaint\b/i,
      /\bprivacy complaint\b/i,
      /\bevidence\b/i,
      /\bscreenshot\b/i,
      /\bmessages?\b/i
    ];
    protectedPatterns = [
      /\blegal aid\b/i,
      /\bevidence\b/i,
      /\bprivacy\b/i,
      /\bidentity\b/i,
      /\bonline safety\b/i
    ];
    excludedPatterns = [
      /\bmigrant\b/i,
      /\bstudent\b/i,
      /\bdiscrimination\b/i,
      /\bracial\b/i,
      /\bbullying\b/i
    ];
    minimumScore = 18;
  } else if (triage.likelyCategory === 'domestic_violence') {
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
    excludedPatterns = [/\bdomestic\b/i];
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
    excludedPatterns = [/\bdomestic\b/i, /\bracial\b/i];
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
  structuredFacts?: unknown;
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
  const enoughContextForTriageAssessment = hasEnoughContextForTriageAssessment(
    session,
    normalizedTimeline
  );
  const triage = enoughContextForTriageAssessment ? await buildTriageForSession(session) : null;
  const offerTriage = Boolean(triage && !shouldBlockTriage(triage));

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
      prompt: offerTriage
        ? 'I am sorry this happened to you. You are safe to explore your options here. Would you like help understanding reporting options, support services, evidence, or your rights?'
        : enoughContextForTriageAssessment
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
  const supportIssueTypes = toRelatedIssueTypes(triage.relatedIssueTypes);
  const recommendationDocs = await SupportServiceModel.find(
    buildRecommendationsFilter({
      issueTypes: supportIssueTypes.length > 0 ? supportIssueTypes : [triage.likelyCategory],
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
  const recommendationIssueTypes = toRelatedIssueTypes(triageRecord.relatedIssueTypes);
  const recommendations = await SupportServiceModel.find(
    buildRecommendationsFilter({
      issueTypes:
        recommendationIssueTypes.length > 0
          ? recommendationIssueTypes
          : [triageRecord.likelyCategory],
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
