import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const conversationFlowSessionParamsSchema = z.object({
  id: objectIdSchema
});

export const createConversationFlowSessionSchema = z.object({
  selectedTopic: z.string().trim().max(120).optional(),
  jurisdiction: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional()
});

export const appendConversationFlowMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  language: z.string().trim().min(2).max(12).default('en')
});

export type CreateConversationFlowSessionInput = z.infer<
  typeof createConversationFlowSessionSchema
>;
export type AppendConversationFlowMessageInput = z.infer<
  typeof appendConversationFlowMessageSchema
>;
