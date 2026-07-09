import type { SafeSpeakModelContext, SafeSpeakRagStatus } from '@modules/ai/safespeak-context-builder';
import type {
  GenerateSafeSpeakResponseOutput,
} from '@modules/ai/model-response.service';

import type {
  ConversationAssistantResponseMode,
  ConversationTurnPolicyDecision
} from './conversation-policy-engine';

export type GroundedLegalSource = {
  sourceId: string;
  title?: string;
  legislationName?: string;
  citationUrl?: string;
};

export type ConversationAssistantPayload = {
  assistantMessage: string;
  nextQuestion: string;
  readyForSubmission?: boolean;
  confidence?: 'low' | 'medium' | 'high';
  disclaimer?: string;
  citations?: GenerateSafeSpeakResponseOutput['citations'];
  showSources?: boolean;
  sourceDisplayReason?: GenerateSafeSpeakResponseOutput['sourceDisplayReason'] | string;
  rag?: GenerateSafeSpeakResponseOutput['rag'];
  reviewStatus?: string;
  responseMode?: GenerateSafeSpeakResponseOutput['responseMode'] | ConversationAssistantResponseMode | string;
  intent?: string;
  usedModelGeneration?: boolean;
  guardrailStatus?: GenerateSafeSpeakResponseOutput['guardrailStatus'] | 'passed' | string;
  fallbackReason?: string;
  staticTemplateUsed?: boolean;
  consentSnapshot?: SafeSpeakModelContext['consentSnapshot'] | Record<string, unknown>;
  intentConfidence?: 'high' | 'medium' | 'low' | string;
  classifierSource?: 'rule' | 'model' | 'hybrid' | string;
  responseSource?: string;
  model?: string;
  jurisdiction?: 'AU';
  ragStatus?: SafeSpeakRagStatus;
  selectedResponseSource?: string;
  repairType?: string;
  subIntent?: string;
  responseVariant?: string;
  triageReady?: boolean;
  nextAction?: string;
  assistantLanguage?: string;
  safetyOverride?: boolean;
  safetyLevel?: string;
  safetyReasons?: string[];
  recommendedImmediateActions?: string[];
  nonIncidentTurn?: boolean;
  triageUpdated?: boolean;
  latestTurnRiskLevel?: string;
  activeIncidentRiskLevel?: string;
  sessionHistoricalMaxRiskLevel?: string;
  activeIssueId?: string;
  assistantFormatPreference?: string;
  formatPreferenceUpdated?: boolean;
  encodingWarning?: boolean;
  matchedSignals?: string[];
  groundedLegalSource?: GroundedLegalSource;
  turnPolicyDecision?: ConversationTurnPolicyDecision;
  humanReviewRecommended?: boolean;
  humanReviewReasons?: string[];
  timeline?: Record<string, unknown>;
};

export type ConversationAssistantMetadata = {
  confidence?: unknown;
  reviewStatus?: string;
  intent?: string;
  responseMode?: string;
  subIntent?: string;
  intentConfidence?: string;
  responseVariant?: string;
  usedModelGeneration?: boolean;
  guardrailStatus?: string;
  fallbackReason?: string;
  staticTemplateUsed?: boolean;
  selectedResponseSource?: string;
  repairType?: string;
  responseSource?: string;
  model?: string;
  jurisdiction?: string;
  ragStatus?: string;
  nonIncidentTurn?: boolean;
  triageUpdated?: boolean;
  latestTurnRiskLevel?: string;
  activeIncidentRiskLevel?: string;
  sessionHistoricalMaxRiskLevel?: string;
  activeIssueId?: string;
  assistantFormatPreference?: string;
  formatPreferenceUpdated?: boolean;
  encodingWarning?: boolean;
  classifierSource?: string;
  matchedSignals?: string[];
  humanReviewRecommended?: boolean;
  humanReviewReasons?: string[];
  turnPolicyDecision?: ConversationTurnPolicyDecision;
  consentSnapshot?: SafeSpeakModelContext['consentSnapshot'] | Record<string, unknown>;
  groundedLegalSource?: GroundedLegalSource;
};

export type ConversationAssistantResponseMeta = {
  confidence: unknown;
  disclaimer: string;
  citations: GenerateSafeSpeakResponseOutput['citations'];
  rag: GenerateSafeSpeakResponseOutput['rag'];
  groundedLegalSource?: GroundedLegalSource;
  reviewStatus: string;
  intent?: string;
  triageReady: boolean;
  nextAction?: string;
  assistantLanguage: string;
  conversationSessionId: string;
  safetyOverride: boolean;
  safetyLevel: string;
  safetyReasons: string[];
  recommendedImmediateActions: string[];
  showSources: boolean;
  sourceDisplayReason: string;
  responseSource: string;
  model?: string;
  guardrailStatus: string;
  ragStatus: string;
  nonIncidentTurn: boolean;
  triageUpdated: boolean;
  latestTurnRiskLevel: string;
  activeIncidentRiskLevel: string;
  sessionHistoricalMaxRiskLevel: string;
  activeIssueId?: string;
  assistantFormatPreference: string;
  formatPreferenceUpdated: boolean;
  encodingWarning: boolean;
  selectedResponseSource: string;
  repairType?: string;
  humanReviewRecommended: boolean;
  humanReviewReasons: string[];
  turnPolicyDecision?: ConversationTurnPolicyDecision;
};
