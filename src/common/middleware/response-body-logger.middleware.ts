import type { NextFunction, Request, Response } from 'express';

import { env } from '@config/env';
import { redactSensitive, truncateForLog } from '@common/utils/sanitize';

const JSON_RESPONSE_LOG_LIMIT = 10_000;

const isJsonContentType = (value: number | string | string[] | undefined): boolean => {
  if (!value) {
    return false;
  }

  return String(Array.isArray(value) ? value.join(';') : value).includes('application/json');
};

const parseJsonSafe = (body: unknown): unknown => {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const withRequestId = (body: unknown, requestId?: string): unknown => {
  if (!requestId || !body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const envelope = body as { success?: unknown; requestId?: unknown };

  if (typeof envelope.success !== 'boolean' || envelope.requestId) {
    return body;
  }

  return {
    ...body,
    requestId
  };
};

export const isConversationMessageAppendRoute = (req: Pick<Request, 'method' | 'originalUrl'>): boolean =>
  req.method === 'POST' &&
  /\/conversation-flow\/sessions\/[^/]+\/messages(?:\?|$)/.test(req.originalUrl);

const buildCompactConversationResponseLog = (envelope: {
  success?: unknown;
  message?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
  data?: {
    session?: {
      id?: unknown;
      status?: unknown;
      latestTurnRiskLevel?: unknown;
      activeIncidentRiskLevel?: unknown;
      sessionHistoricalMaxRiskLevel?: unknown;
      assistantFormatPreference?: unknown;
      messageCount?: unknown;
      userTurnCount?: unknown;
    };
    userMessage?: {
      turnNumber?: unknown;
      content?: unknown;
    };
    assistantMessage?: {
      turnNumber?: unknown;
      content?: unknown;
      metadata?: {
        intent?: unknown;
        intentConfidence?: unknown;
        responseSource?: unknown;
        selectedResponseSource?: unknown;
        model?: unknown;
        guardrailStatus?: unknown;
        fallbackReason?: unknown;
        ragStatus?: unknown;
        nonIncidentTurn?: unknown;
        triageUpdated?: unknown;
        latestTurnRiskLevel?: unknown;
        activeIncidentRiskLevel?: unknown;
        sessionHistoricalMaxRiskLevel?: unknown;
        assistantFormatPreference?: unknown;
        formatPreferenceUpdated?: unknown;
        encodingWarning?: unknown;
      };
    };
    triage?: {
      likelyCategory?: unknown;
      safetyRiskLevel?: unknown;
      confidenceScore?: unknown;
    } | null;
  };
}) => ({
  success: envelope.success,
  message: envelope.message,
  timestamp: envelope.timestamp,
  requestId: envelope.requestId,
  conversation: {
    sessionId: envelope.data?.session?.id,
    status: envelope.data?.session?.status,
    latestUserMessageFirst120:
      typeof envelope.data?.userMessage?.content === 'string'
        ? envelope.data.userMessage.content.slice(0, 120)
        : undefined,
    userTurnNumber: envelope.data?.userMessage?.turnNumber,
    assistantResponseFirst120:
      typeof envelope.data?.assistantMessage?.content === 'string'
        ? envelope.data.assistantMessage.content.slice(0, 120)
        : undefined,
    assistantTurnNumber: envelope.data?.assistantMessage?.turnNumber,
    detectedIntent: envelope.data?.assistantMessage?.metadata?.intent,
    intentConfidence: envelope.data?.assistantMessage?.metadata?.intentConfidence,
    responseSource: envelope.data?.assistantMessage?.metadata?.responseSource,
    selectedResponseSource: envelope.data?.assistantMessage?.metadata?.selectedResponseSource,
    model: envelope.data?.assistantMessage?.metadata?.model,
    ragStatus: envelope.data?.assistantMessage?.metadata?.ragStatus,
    guardrailStatus: envelope.data?.assistantMessage?.metadata?.guardrailStatus,
    fallbackReason: envelope.data?.assistantMessage?.metadata?.fallbackReason,
    nonIncidentTurn: envelope.data?.assistantMessage?.metadata?.nonIncidentTurn,
    triageUpdated: envelope.data?.assistantMessage?.metadata?.triageUpdated,
    latestTurnRiskLevel: envelope.data?.assistantMessage?.metadata?.latestTurnRiskLevel,
    activeIncidentRiskLevel: envelope.data?.assistantMessage?.metadata?.activeIncidentRiskLevel,
    sessionHistoricalMaxRiskLevel:
      envelope.data?.assistantMessage?.metadata?.sessionHistoricalMaxRiskLevel,
    assistantFormatPreference:
      envelope.data?.assistantMessage?.metadata?.assistantFormatPreference ??
      envelope.data?.session?.assistantFormatPreference,
    formatPreferenceUpdated:
      envelope.data?.assistantMessage?.metadata?.formatPreferenceUpdated,
    encodingWarning: envelope.data?.assistantMessage?.metadata?.encodingWarning,
    messageCount: envelope.data?.session?.messageCount,
    userTurnCount: envelope.data?.session?.userTurnCount,
    triageSummary: envelope.data?.triage
      ? {
          exists: true,
          likelyCategory: envelope.data.triage.likelyCategory,
          safetyRiskLevel: envelope.data.triage.safetyRiskLevel,
          confidenceScore: envelope.data.triage.confidenceScore
        }
      : {
          exists: false
        }
  }
});

export const summarizeResponseBodyForLogging = (input: {
  body: unknown;
  request: Pick<Request, 'method' | 'originalUrl'>;
  debugFullResponse?: boolean;
}): unknown => {
  if (!isConversationMessageAppendRoute(input.request)) {
    return input.body;
  }

  if (input.debugFullResponse ?? env.DEBUG_FULL_RESPONSE) {
    return input.body;
  }

  if (!input.body || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return input.body;
  }

  const envelope = input.body as {
    success?: unknown;
    message?: unknown;
    timestamp?: unknown;
    requestId?: unknown;
    data?: {
      session?: {
        id?: unknown;
        selectedTopic?: unknown;
        detectedLanguage?: unknown;
        status?: unknown;
        safetyRiskLevel?: unknown;
        latestTurnRiskLevel?: unknown;
        activeIncidentRiskLevel?: unknown;
        sessionHistoricalMaxRiskLevel?: unknown;
        assistantFormatPreference?: unknown;
        messageCount?: unknown;
        userTurnCount?: unknown;
      };
      userMessage?: {
        id?: unknown;
        role?: unknown;
        content?: unknown;
        turnNumber?: unknown;
      };
      assistantMessage?: {
        id?: unknown;
        role?: unknown;
        content?: unknown;
        turnNumber?: unknown;
        metadata?: {
          intent?: unknown;
          responseMode?: unknown;
          intentConfidence?: unknown;
          usedModelGeneration?: unknown;
          staticTemplateUsed?: unknown;
          responseSource?: unknown;
          selectedResponseSource?: unknown;
          model?: unknown;
          guardrailStatus?: unknown;
          fallbackReason?: unknown;
          ragStatus?: unknown;
          nonIncidentTurn?: unknown;
          triageUpdated?: unknown;
          latestTurnRiskLevel?: unknown;
          activeIncidentRiskLevel?: unknown;
          sessionHistoricalMaxRiskLevel?: unknown;
          assistantFormatPreference?: unknown;
          formatPreferenceUpdated?: unknown;
          encodingWarning?: unknown;
          classifierSource?: unknown;
          matchedSignals?: unknown;
        };
      };
      triage?: {
        likelyCategory?: unknown;
        confidenceScore?: unknown;
        safetyRiskLevel?: unknown;
        relatedIssueTypes?: unknown;
        structuredFacts?: {
          physicalViolence?: unknown;
          threatsPresent?: unknown;
          immediateDanger?: unknown;
          evidenceAvailable?: unknown;
          scamFraud?: unknown;
          workplaceBullying?: unknown;
          racismDiscrimination?: unknown;
          migrationOrVisaThreat?: unknown;
          languageOrInterpreterNeed?: unknown;
        };
      } | null;
      responseMeta?: {
        intent?: unknown;
        reviewStatus?: unknown;
        responseSource?: unknown;
        selectedResponseSource?: unknown;
        model?: unknown;
        ragStatus?: unknown;
        guardrailStatus?: unknown;
        nonIncidentTurn?: unknown;
        triageUpdated?: unknown;
        assistantLanguage?: unknown;
        showSources?: unknown;
        sourceDisplayReason?: unknown;
      };
    };
  };

  return buildCompactConversationResponseLog(envelope);
};

export const responseBodyLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (body: unknown): Response => {
    const responseBody = withRequestId(body, req.requestId);
    res.locals.responseBody = truncateForLog(
      redactSensitive(
        summarizeResponseBodyForLogging({
          body: responseBody,
          request: req,
          debugFullResponse: env.DEBUG_FULL_RESPONSE
        })
      ),
      JSON_RESPONSE_LOG_LIMIT
    );

    return originalJson(responseBody);
  };

  res.send = (body?: unknown): Response => {
    if (isJsonContentType(res.getHeader('content-type'))) {
      const parsedBody = parseJsonSafe(body);

      if (parsedBody !== undefined) {
        res.locals.responseBody = truncateForLog(
          redactSensitive(parsedBody),
          JSON_RESPONSE_LOG_LIMIT
        );
      }
    }

    return originalSend(body);
  };

  next();
};
