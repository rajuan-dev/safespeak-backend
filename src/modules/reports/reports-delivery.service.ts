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

export type DeliveryConfigurationStatus = 'ready' | 'manual_action' | 'config_missing';
export type DeliveryMode = 'automated' | 'manual' | 'config_missing';

export type DeliveryReadiness = {
  status: DeliveryConfigurationStatus;
  mode: DeliveryMode;
  canAutoSend: boolean;
  actuallySends: boolean;
  credentialConfigured: boolean;
  credentialReference?: string;
  configurationIssues: string[];
  endpointUrl?: string;
};

export type DeliveryExecutionResult = {
  status: 'submitted' | 'acknowledged' | 'requires_manual_action' | 'config_missing' | 'failed';
  externalReference?: string;
  message?: string;
  acknowledgementPayload?: Record<string, unknown>;
  deliveryArtifacts?: DeliveryArtifact[];
  deliveryMode: DeliveryMode;
  deliveryConfigurationStatus: DeliveryConfigurationStatus;
  deliveryConfigurationIssues: string[];
  credentialReference?: string;
  actuallySent: boolean;
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

const getMetadataString = (
  metadata: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = metadata[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getMergedDeliveryMetadata = (
  destination: AdminDestinationDocument,
  template?: AdminSubmissionTemplateDocument | null
): Record<string, unknown> => ({
    ...destination.metadata,
    ...(template?.metadata ?? {})
  });

const getEnvValue = (key?: string): string | undefined => {
  if (!key) {
    return undefined;
  }

  const value = process.env[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getStaticBearerToken = (
  destination: AdminDestinationDocument,
  template?: AdminSubmissionTemplateDocument | null
): { token?: string; reference?: string } => {
  const metadata = getMergedDeliveryMetadata(destination, template);
  const envTokenKey = getMetadataString(metadata, 'authTokenEnvKey');
  const metadataToken = getEnvValue(envTokenKey);

  if (metadataToken) {
    return {
      token: metadataToken,
      reference: envTokenKey
    };
  }

  if (env.DELIVERY_API_BEARER_TOKEN) {
    return {
      token: env.DELIVERY_API_BEARER_TOKEN,
      reference: 'DELIVERY_API_BEARER_TOKEN'
    };
  }

  return {};
};

const getEmailWebhookConfig = (
  destination: AdminDestinationDocument,
  template?: AdminSubmissionTemplateDocument | null
): {
  url?: string;
  token?: string;
  urlReference?: string;
  tokenReference?: string;
} => {
  const metadata = getMergedDeliveryMetadata(destination, template);
  const urlEnvKey = getMetadataString(metadata, 'emailWebhookUrlEnvKey');
  const tokenEnvKey = getMetadataString(metadata, 'emailWebhookTokenEnvKey');
  const urlFromMetadata = getMetadataString(metadata, 'emailWebhookUrl');
  const urlFromEnv = getEnvValue(urlEnvKey);
  const tokenFromEnv = getEnvValue(tokenEnvKey);

  return {
    url: urlFromEnv ?? urlFromMetadata ?? env.DELIVERY_EMAIL_WEBHOOK_URL,
    token: tokenFromEnv ?? env.DELIVERY_EMAIL_WEBHOOK_TOKEN,
    urlReference: urlFromEnv ? urlEnvKey : urlFromMetadata ? 'destination.metadata.emailWebhookUrl' : 'DELIVERY_EMAIL_WEBHOOK_URL',
    tokenReference: tokenFromEnv ? tokenEnvKey : env.DELIVERY_EMAIL_WEBHOOK_TOKEN ? 'DELIVERY_EMAIL_WEBHOOK_TOKEN' : undefined
  };
};

const getMtlsProxyUrl = (
  destination: AdminDestinationDocument,
  template?: AdminSubmissionTemplateDocument | null
): { url?: string; reference?: string } => {
  const metadata = getMergedDeliveryMetadata(destination, template);
  const proxyEnvKey = getMetadataString(metadata, 'mtlsProxyUrlEnvKey');
  const proxyFromEnv = getEnvValue(proxyEnvKey);

  if (proxyFromEnv) {
    return {
      url: proxyFromEnv,
      reference: proxyEnvKey
    };
  }

  if (env.DELIVERY_MTLS_PROXY_URL) {
    return {
      url: env.DELIVERY_MTLS_PROXY_URL,
      reference: 'DELIVERY_MTLS_PROXY_URL'
    };
  }

  return {};
};

const createReadiness = (
  status: DeliveryConfigurationStatus,
  options: Omit<DeliveryReadiness, 'status'>
): DeliveryReadiness => ({
  status,
  ...options
});

const getMissingConfigReadiness = (
  configurationIssues: string[],
  credentialReference?: string
): DeliveryReadiness =>
  createReadiness('config_missing', {
    mode: 'config_missing',
    canAutoSend: false,
    actuallySends: false,
    credentialConfigured: false,
    credentialReference,
    configurationIssues
  });

export const getDestinationDeliveryReadiness = (
  destination: AdminDestinationDocument,
  template?: AdminSubmissionTemplateDocument | null
): DeliveryReadiness => {
  switch (destination.channel) {
    case 'api_oauth': {
      const credential = getStaticBearerToken(destination, template);
      const configurationIssues = [
        destination.endpoint ? undefined : 'API endpoint is not configured.',
        credential.token ? undefined : 'API bearer token is not configured.'
      ].filter((issue): issue is string => Boolean(issue));

      if (configurationIssues.length > 0) {
        return getMissingConfigReadiness(configurationIssues, credential.reference);
      }

      return createReadiness('ready', {
        mode: 'automated',
        canAutoSend: true,
        actuallySends: true,
        credentialConfigured: true,
        credentialReference: credential.reference,
        configurationIssues: [],
        endpointUrl: destination.endpoint
      });
    }
    case 'api_mtls': {
      const credential = getStaticBearerToken(destination, template);
      const mtlsProxy = getMtlsProxyUrl(destination, template);
      const configurationIssues = [
        destination.endpoint ? undefined : 'API endpoint is not configured.',
        mtlsProxy.url ? undefined : 'mTLS delivery proxy is not configured.',
        credential.token ? undefined : 'API bearer token is not configured.'
      ].filter((issue): issue is string => Boolean(issue));

      if (configurationIssues.length > 0) {
        return getMissingConfigReadiness(
          configurationIssues,
          [credential.reference, mtlsProxy.reference].filter(Boolean).join(', ') || undefined
        );
      }

      return createReadiness('ready', {
        mode: 'automated',
        canAutoSend: true,
        actuallySends: true,
        credentialConfigured: true,
        credentialReference: [credential.reference, mtlsProxy.reference].filter(Boolean).join(', '),
        configurationIssues: [],
        endpointUrl: mtlsProxy.url
      });
    }
    case 'secure_email':
    case 'secure_email_pgp': {
      const webhook = getEmailWebhookConfig(destination, template);
      const configurationIssues = [
        destination.contactEmail ? undefined : 'Destination contact email is not configured.',
        webhook.url ? undefined : 'Secure email webhook URL is not configured.',
        webhook.token ? undefined : 'Secure email webhook token is not configured.'
      ].filter((issue): issue is string => Boolean(issue));

      if (configurationIssues.length > 0) {
        return getMissingConfigReadiness(configurationIssues, webhook.tokenReference);
      }

      return createReadiness('ready', {
        mode: 'automated',
        canAutoSend: true,
        actuallySends: true,
        credentialConfigured: true,
        credentialReference: webhook.tokenReference,
        configurationIssues: [],
        endpointUrl: webhook.url
      });
    }
    case 'booking_link':
      if (!destination.endpoint) {
        return getMissingConfigReadiness(['Booking or official handoff URL is not configured.']);
      }

      return createReadiness('manual_action', {
        mode: 'manual',
        canAutoSend: false,
        actuallySends: false,
        credentialConfigured: false,
        configurationIssues: [],
        endpointUrl: destination.endpoint
      });
    case 'manual_export_pdf':
    case 'manual_export_json':
      return createReadiness('manual_action', {
        mode: 'manual',
        canAutoSend: false,
        actuallySends: false,
        credentialConfigured: false,
        configurationIssues: []
      });
    default:
      return getMissingConfigReadiness([
        `Unsupported delivery channel: ${String(destination.channel)}`
      ]);
  }
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
  readiness: DeliveryReadiness,
  extraHeaders: Record<string, string> = {}
): Promise<DeliveryExecutionResult> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...extraHeaders
  };
  const { token: bearerToken } = getStaticBearerToken(input.destination, input.template);

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
        deliveryMode: readiness.mode,
        deliveryConfigurationStatus: readiness.status,
        deliveryConfigurationIssues: readiness.configurationIssues,
        credentialReference: readiness.credentialReference,
        actuallySent: false,
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
      deliveryMode: readiness.mode,
      deliveryConfigurationStatus: readiness.status,
      deliveryConfigurationIssues: readiness.configurationIssues,
      credentialReference: readiness.credentialReference,
      actuallySent: true,
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
      message: error instanceof Error ? error.message : 'Delivery request failed',
      deliveryMode: readiness.mode,
      deliveryConfigurationStatus: readiness.status,
      deliveryConfigurationIssues: readiness.configurationIssues,
      credentialReference: readiness.credentialReference,
      actuallySent: false
    };
  }
};

const queueEmailOutbox = async (
  input: DeliveryExecutionInput,
  pgpRequired: boolean,
  readiness: DeliveryReadiness
) => {
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
  const webhook = getEmailWebhookConfig(input.destination, input.template);

  if (webhook.url) {
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(webhook.token ? { authorization: `Bearer ${webhook.token}` } : {})
        },
        body: JSON.stringify(outboxPayload),
        signal: AbortSignal.timeout(env.DELIVERY_API_TIMEOUT_MS)
      });

      if (response.ok) {
        return {
          status: 'submitted',
          message: 'Secure email queued via webhook',
          deliveryMode: readiness.mode,
          deliveryConfigurationStatus: readiness.status,
          deliveryConfigurationIssues: readiness.configurationIssues,
          credentialReference: readiness.credentialReference,
          actuallySent: true,
          deliveryArtifacts: [
            { kind: 'email_outbox', label: 'Email outbox payload', path: outboxPath }
          ]
        } satisfies DeliveryExecutionResult;
      }

      return {
        status: 'failed',
        message: `Secure email webhook returned ${response.status}`,
        deliveryMode: readiness.mode,
        deliveryConfigurationStatus: readiness.status,
        deliveryConfigurationIssues: readiness.configurationIssues,
        credentialReference: readiness.credentialReference,
        actuallySent: false,
        deliveryArtifacts: [
          { kind: 'email_outbox', label: 'Email outbox payload', path: outboxPath }
        ]
      } satisfies DeliveryExecutionResult;
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Secure email webhook request failed',
        deliveryMode: readiness.mode,
        deliveryConfigurationStatus: readiness.status,
        deliveryConfigurationIssues: readiness.configurationIssues,
        credentialReference: readiness.credentialReference,
        actuallySent: false,
        deliveryArtifacts: [
          { kind: 'email_outbox', label: 'Email outbox payload', path: outboxPath }
        ]
      } satisfies DeliveryExecutionResult;
    }
  }

  return {
    status: 'config_missing',
    message: 'Secure email webhook is not configured; no email was sent',
    deliveryMode: 'config_missing',
    deliveryConfigurationStatus: 'config_missing',
    deliveryConfigurationIssues: ['Secure email webhook URL is not configured.'],
    actuallySent: false,
    deliveryArtifacts: [{ kind: 'email_outbox', label: 'Email outbox payload', path: outboxPath }]
  } satisfies DeliveryExecutionResult;
};

const exportManualPayload = async (
  input: DeliveryExecutionInput,
  kind: 'json_export' | 'booking_link',
  readiness: DeliveryReadiness
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
    deliveryMode: readiness.mode,
    deliveryConfigurationStatus: readiness.status,
    deliveryConfigurationIssues: readiness.configurationIssues,
    credentialReference: readiness.credentialReference,
    actuallySent: false,
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
  const readiness = getDestinationDeliveryReadiness(input.destination, input.template);

  if (readiness.status === 'config_missing') {
    return {
      status: 'config_missing',
      message: `Delivery configuration missing: ${readiness.configurationIssues.join(' ')}`,
      deliveryMode: readiness.mode,
      deliveryConfigurationStatus: readiness.status,
      deliveryConfigurationIssues: readiness.configurationIssues,
      credentialReference: readiness.credentialReference,
      actuallySent: false
    };
  }

  switch (input.destination.channel) {
    case 'api_oauth':
      return sendJsonToEndpoint(readiness.endpointUrl ?? input.destination.endpoint ?? '', input, readiness);
    case 'api_mtls':
      return sendJsonToEndpoint(readiness.endpointUrl ?? input.destination.endpoint ?? '', input, readiness, {
        'x-safespeak-delivery-target': input.destination.endpoint ?? '',
        'x-safespeak-delivery-mode': 'mtls-proxy-required'
      });
    case 'secure_email':
      return queueEmailOutbox(input, false, readiness);
    case 'secure_email_pgp':
      return queueEmailOutbox(input, true, readiness);
    case 'manual_export_pdf':
    case 'manual_export_json':
      return exportManualPayload(input, 'json_export', readiness);
    case 'booking_link':
      return exportManualPayload(input, 'booking_link', readiness);
    default:
      return {
        status: 'failed',
        message: `Unsupported delivery channel: ${String(input.destination.channel)}`,
        deliveryMode: 'config_missing',
        deliveryConfigurationStatus: 'config_missing',
        deliveryConfigurationIssues: [`Unsupported delivery channel: ${String(input.destination.channel)}`],
        actuallySent: false
      };
  }
};

export const getValueAtPath = (record: Record<string, unknown>, source: string): unknown => {
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

export const getMissingRequiredTemplateFields = (
  template: AdminSubmissionTemplateDocument | null | undefined,
  basePayload: Record<string, unknown>
): string[] => {
  if (!template) {
    return [];
  }

  return template.fieldMappings
    .filter((mapping) => mapping.required)
    .filter((mapping) => {
      const value = getValueAtPath(basePayload, mapping.source);

      if (typeof value === 'string') {
        return !value.trim();
      }

      if (Array.isArray(value)) {
        return value.length === 0;
      }

      return value === undefined || value === null;
    })
    .map((mapping) => mapping.source);
};
