import type { SupportedAssistantLanguageCode } from '@modules/ai/assistant-language';
import type {
  CONVERSATION_FLOW_CATEGORIES,
  CONVERSATION_FLOW_MESSAGE_ROLES,
  CONVERSATION_FLOW_RISK_LEVELS,
  CONVERSATION_FLOW_STATUSES
} from './conversation-flow.constants';

export type ConversationFlowStatus = (typeof CONVERSATION_FLOW_STATUSES)[number];
export type ConversationFlowMessageRole = (typeof CONVERSATION_FLOW_MESSAGE_ROLES)[number];
export type ConversationFlowRiskLevel = (typeof CONVERSATION_FLOW_RISK_LEVELS)[number];
export type ConversationFlowCategory = (typeof CONVERSATION_FLOW_CATEGORIES)[number];
export type SupportedConversationLanguage = SupportedAssistantLanguageCode;

export interface ConversationFlowOwner {
  userId?: string;
  sessionId?: string;
}

export interface ConversationFlowContext {
  owner: ConversationFlowOwner;
  ip?: string;
  userAgent?: string;
}
