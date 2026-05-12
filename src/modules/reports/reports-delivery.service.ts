import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '@config/env';
import type { AdminDestinationDocument, AdminSubmissionTemplateDocument } from '@modules/admin/admin.model';

type DeliveryArtifact = {
  kind: 'json_export' | 'email_outbox' | 'api_response' | 'booking_link';
  label: string;
  path?: string;
  url?: string;
};

export type DeliveryExecutionResult = {
  status: 'submitted' | 'acknowledged' | 'requires_manual_action' | 'failed';
  externalReference?: string;
  message?: string;
  acknowledgementPayload?: Record<string, unknown>;
  deliveryArtifacts?: DeliveryArtifact[];
};

export type DeliveryExecutionInput = {
  submissionId: string;
  refNo: string;
  destination: AdminDestinationDocument;
  template?: AdminSubmissionTemplateDocument | null;
  payload: Record<string, unknown>;
};

const ensureExportDirectory = async (reportRef: string): Promise<string> => {
  const exportDirectory = path.resolve(env.REPORT_DELIVERY_EXPORT_PATH, reportRef);
  await fs.mkdir(exportDirectory, { recursive: true });
  return exportDirectory;
};

const writeExportArtifact = async (
  reportRef: string,
  fileName: string,
  content: string
): Promise<string> => {
  const exportDirectory = await ensureExportDirectory(reportRef);
  const filePath = path.join(exportDirectory, fileName);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
};

const getStaticBearerToken = (
  destination: AdminDestinationDocument,
  template?: AdminSubmissionTemplateDocument | null
): string | undefined => {
  const metadata = {
    ...destination.metadata,
    ...(template?.metadata ?? {})
  };
  const envTokenKey = typeof metadata.authTokenEnvKey === 'string' ? metadata.authTokenEnvKey : null;

  if (envTokenKey && typeof process.env[envTokenKey] === 'string' && process.env[envTokenKey]?.trim()) {
    return process.env[envTokenKey];
  }

  return env.DELIVERY_API_BEARER_TOKEN;
};

const toDisplayString = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
};

const sendJsonToEndpoint = async (
  url: string,
  input: DeliveryExecutionInput,
  extraHeaders: Record<string, string> = {}
): Promise<DeliveryExecutionResult> => {
  if (!url) {
    return {
      status: 'failed',
      message: 'Destination endpoint is not configured'
    };
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...extraHeaders
  };
  const bearerToken = getStaticBearerToken(input.destination, input.template);

  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(env.DELIVERY_API_TIMEOUT_MS)
    });
    const responseText = await response.text();
    const externalReference = response.headers.get('x-reference-id') ?? undefined;

    if (!response.ok) {
      return {
        status: 'failed',
        message: `Delivery endpoint returned ${response.status}`,
        acknowledgementPayload: {
          statusCode: response.status,
          body: responseText.slice(0, 5000)
        }
      };
    }

    return {
      status: externalReference ? 'acknowledged' : 'submitted',
      externalReference,
      message: `Delivered to ${url}`,
      acknowledgementPayload: {
        statusCode: response.status,
        body: responseText.slice(0, 5000)
      },
      deliveryArtifacts: [
        {
          kind: 'api_response',
          label: 'API delivery response',
          url
        }
      ]
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Delivery request failed'
    };
  }
};

const queueEmailOutbox = async (input: DeliveryExecutionInput, pgpRequired: boolean) => {
  const outboxPayload = {
    to: input.destination.contactEmail,
    subject: toDisplayString(input.payload.title ?? `SafeSpeak report ${input.refNo}`),
    body: input.payload,
    pgpRequired
  };
  const outboxPath = await writeExportArtifact(
    input.refNo,
    `${input.submissionId}-${pgpRequired ? 'secure-email-pgp' : 'secure-email'}.json`,
    JSON.stringify(outboxPayload, null, 2)
  );

  if (env.DELIVERY_EMAIL_WEBHOOK_URL) {
    const response = await fetch(env.DELIVERY_EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.DELIVERY_EMAIL_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${env.DELIVERY_EMAIL_WEBHOOK_TOKEN}` }
          : {})
      },
      body: JSON.stringify(outboxPayload),
      signal: AbortSignal.timeout(env.DELIVERY_API_TIMEOUT_MS)
    });

    if (response.ok) {
      return {
        status: 'submitted',
        message: 'Secure email queued via webhook',
        deliveryArtifacts: [
          { kind: 'email_outbox', label: 'Email outbox payload', path: outboxPath }
        ]
      } satisfies DeliveryExecutionResult;
    }
  }

  return {
    status: 'requires_manual_action',
    message: 'Secure email payload exported for manual dispatch',
    deliveryArtifacts: [
      { kind: 'email_outbox', label: 'Email outbox payload', path: outboxPath }
    ]
  } satisfies DeliveryExecutionResult;
};

const exportManualPayload = async (
  input: DeliveryExecutionInput,
  kind: 'json_export' | 'booking_link'
): Promise<DeliveryExecutionResult> => {
  const filePath = await writeExportArtifact(
    input.refNo,
    `${input.submissionId}-${kind}.json`,
    JSON.stringify(input.payload, null, 2)
  );

  return {
    status: 'requires_manual_action',
    message:
      kind === 'booking_link'
        ? 'Booking/link destination prepared for manual follow-through'
        : 'Manual export prepared',
    deliveryArtifacts: [
      {
        kind,
        label: kind === 'booking_link' ? 'Booking handoff payload' : 'Manual export payload',
        path: filePath,
        url: typeof input.destination.endpoint === 'string' ? input.destination.endpoint : undefined
      }
    ]
  };
};

export const executeReportDelivery = async (
  input: DeliveryExecutionInput
): Promise<DeliveryExecutionResult> => {
  switch (input.destination.channel) {
    case 'api_oauth':
      return sendJsonToEndpoint(input.destination.endpoint ?? '', input);
    case 'api_mtls':
      return sendJsonToEndpoint(input.destination.endpoint ?? '', input, {
        'x-safespeak-delivery-mode': 'mtls-proxy-required'
      });
    case 'secure_email':
      return queueEmailOutbox(input, false);
    case 'secure_email_pgp':
      return queueEmailOutbox(input, true);
    case 'manual_export_pdf':
    case 'manual_export_json':
      return exportManualPayload(input, 'json_export');
    case 'booking_link':
      return exportManualPayload(input, 'booking_link');
    default:
      return {
        status: 'failed',
        message: `Unsupported delivery channel: ${String(input.destination.channel)}`
      };
  }
};

const getValueAtPath = (record: Record<string, unknown>, source: string): unknown => {
  return source.split('.').reduce<unknown>((currentValue, segment) => {
    if (currentValue && typeof currentValue === 'object' && segment in currentValue) {
      return (currentValue as Record<string, unknown>)[segment];
    }

    return undefined;
  }, record);
};

const applyTransform = (value: unknown, transform?: string): unknown => {
  if (!transform) {
    return value;
  }

  switch (transform) {
    case 'uppercase':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'string':
      return toDisplayString(value);
    default:
      return value;
  }
};

export const renderTemplateString = (
  template: string,
  context: Record<string, unknown>
): string =>
  template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawKey: string) => {
    const resolvedValue = getValueAtPath(context, rawKey.trim());
    return resolvedValue === undefined || resolvedValue === null ? '' : toDisplayString(resolvedValue);
  });

export const buildSubmissionPayloadFromTemplate = (
  template: AdminSubmissionTemplateDocument | null | undefined,
  basePayload: Record<string, unknown>
): Record<string, unknown> => {
  if (!template) {
    return basePayload;
  }

  const mappedFields = Object.fromEntries(
    template.fieldMappings.map((mapping) => [
      mapping.target,
      applyTransform(getValueAtPath(basePayload, mapping.source), mapping.transform)
    ])
  );

  return {
    ...template.staticPayload,
    ...mappedFields,
    title: renderTemplateString(template.titleTemplate, basePayload),
    summary: renderTemplateString(template.summaryTemplate, basePayload),
    safespeak: basePayload
  };
};
