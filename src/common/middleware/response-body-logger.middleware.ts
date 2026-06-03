import type { NextFunction, Request, Response } from 'express';

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

export const summarizeResponseBodyForLogging = (input: {
  body: unknown;
  request: Pick<Request, 'method' | 'originalUrl'>;
}): unknown => {
  if (!isConversationMessageAppendRoute(input.request)) {
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

  return {
    success: envelope.success,
    message: envelope.message,
    timestamp: envelope.timestamp,
    requestId: envelope.requestId,
    data: {
      session: envelope.data?.session
        ? {
            id: envelope.data.session.id,
            selectedTopic: envelope.data.session.selectedTopic,
            detectedLanguage: envelope.data.session.detectedLanguage,
            status: envelope.data.session.status,
            safetyRiskLevel: envelope.data.session.safetyRiskLevel,
            latestTurnRiskLevel: envelope.data.session.latestTurnRiskLevel,
            activeIncidentRiskLevel: envelope.data.session.activeIncidentRiskLevel,
            sessionHistoricalMaxRiskLevel: envelope.data.session.sessionHistoricalMaxRiskLevel,
            assistantFormatPreference: envelope.data.session.assistantFormatPreference,
            messageCount: envelope.data.session.messageCount,
            userTurnCount: envelope.data.session.userTurnCount
          }
        : undefined,
      userMessage: envelope.data?.userMessage
        ? {
            id: envelope.data.userMessage.id,
            role: envelope.data.userMessage.role,
            content: envelope.data.userMessage.content,
            turnNumber: envelope.data.userMessage.turnNumber
          }
        : undefined,
      assistantMessage: envelope.data?.assistantMessage
        ? {
            id: envelope.data.assistantMessage.id,
            role: envelope.data.assistantMessage.role,
            content: envelope.data.assistantMessage.content,
            turnNumber: envelope.data.assistantMessage.turnNumber,
            metadata: envelope.data.assistantMessage.metadata
              ? {
                  intent: envelope.data.assistantMessage.metadata.intent,
                  responseMode: envelope.data.assistantMessage.metadata.responseMode,
                  intentConfidence: envelope.data.assistantMessage.metadata.intentConfidence,
                  usedModelGeneration: envelope.data.assistantMessage.metadata.usedModelGeneration,
                  staticTemplateUsed: envelope.data.assistantMessage.metadata.staticTemplateUsed,
                  responseSource: envelope.data.assistantMessage.metadata.responseSource,
                  selectedResponseSource:
                    envelope.data.assistantMessage.metadata.selectedResponseSource,
                  model: envelope.data.assistantMessage.metadata.model,
                  guardrailStatus: envelope.data.assistantMessage.metadata.guardrailStatus,
                  fallbackReason: envelope.data.assistantMessage.metadata.fallbackReason,
                  ragStatus: envelope.data.assistantMessage.metadata.ragStatus,
                  nonIncidentTurn: envelope.data.assistantMessage.metadata.nonIncidentTurn,
                  triageUpdated: envelope.data.assistantMessage.metadata.triageUpdated,
                  latestTurnRiskLevel: envelope.data.assistantMessage.metadata.latestTurnRiskLevel,
                  activeIncidentRiskLevel:
                    envelope.data.assistantMessage.metadata.activeIncidentRiskLevel,
                  sessionHistoricalMaxRiskLevel:
                    envelope.data.assistantMessage.metadata.sessionHistoricalMaxRiskLevel,
                  assistantFormatPreference:
                    envelope.data.assistantMessage.metadata.assistantFormatPreference,
                  formatPreferenceUpdated:
                    envelope.data.assistantMessage.metadata.formatPreferenceUpdated,
                  encodingWarning: envelope.data.assistantMessage.metadata.encodingWarning,
                  classifierSource: envelope.data.assistantMessage.metadata.classifierSource,
                  matchedSignals: envelope.data.assistantMessage.metadata.matchedSignals
                }
              : undefined
          }
        : undefined,
      triageSummary: envelope.data?.triage
        ? {
            exists: true,
            likelyCategory: envelope.data.triage.likelyCategory,
            confidenceScore: envelope.data.triage.confidenceScore,
            safetyRiskLevel: envelope.data.triage.safetyRiskLevel,
            relatedIssueTypes: envelope.data.triage.relatedIssueTypes,
            structuredFacts: envelope.data.triage.structuredFacts
              ? {
                  physicalViolence: envelope.data.triage.structuredFacts.physicalViolence,
                  threatsPresent: envelope.data.triage.structuredFacts.threatsPresent,
                  immediateDanger: envelope.data.triage.structuredFacts.immediateDanger,
                  evidenceAvailable: envelope.data.triage.structuredFacts.evidenceAvailable,
                  scamFraud: envelope.data.triage.structuredFacts.scamFraud,
                  workplaceBullying: envelope.data.triage.structuredFacts.workplaceBullying,
                  racismDiscrimination:
                    envelope.data.triage.structuredFacts.racismDiscrimination,
                  migrationOrVisaThreat:
                    envelope.data.triage.structuredFacts.migrationOrVisaThreat,
                  languageOrInterpreterNeed:
                    envelope.data.triage.structuredFacts.languageOrInterpreterNeed
                }
              : undefined
          }
        : {
            exists: false
          },
      responseMeta: envelope.data?.responseMeta
        ? {
            intent: envelope.data.responseMeta.intent,
            reviewStatus: envelope.data.responseMeta.reviewStatus,
            responseSource: envelope.data.responseMeta.responseSource,
            selectedResponseSource: envelope.data.responseMeta.selectedResponseSource,
            model: envelope.data.responseMeta.model,
            ragStatus: envelope.data.responseMeta.ragStatus,
            guardrailStatus: envelope.data.responseMeta.guardrailStatus,
            nonIncidentTurn: envelope.data.responseMeta.nonIncidentTurn,
            triageUpdated: envelope.data.responseMeta.triageUpdated,
            assistantLanguage: envelope.data.responseMeta.assistantLanguage,
            showSources: envelope.data.responseMeta.showSources,
            sourceDisplayReason: envelope.data.responseMeta.sourceDisplayReason
          }
        : undefined
    }
  };
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
          request: req
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
