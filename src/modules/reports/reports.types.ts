import type {
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  REPORT_SUBMISSION_ANONYMITY_MODES,
  REPORT_SUBMISSION_STATUSES
} from './reports.constants';

export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];
export type ReportOwnerType = 'anonymous' | 'user';
export type ReportSubmissionStatus = (typeof REPORT_SUBMISSION_STATUSES)[number];
export type ReportSubmissionAnonymityMode =
  (typeof REPORT_SUBMISSION_ANONYMITY_MODES)[number];

export interface ReportOwner {
  userId?: string;
  sessionId?: string;
}

export interface ReportStructuredFields {
  who?: string;
  what?: string;
  when?: string;
  where?: string;
  how?: string;
  witnesses?: string;
  repeatedIncidents?: boolean;
  injuries?: string;
  evidenceItems?: unknown[];
}

export interface ReportDestinationPreview {
  destinationId: string;
  destinationKey: string;
  destinationType: string;
  destinationName: string;
  channel: string;
  jurisdiction: string;
  languages: string[];
  endpoint?: string;
  contactEmail?: string;
  contactPhone?: string;
  minimumRequiredInfo: string[];
  missingRequiredInfo: string[];
  anonymityOptions: string[];
  expectedNextSteps: string[];
  consentRequired: boolean;
  supportsAcknowledgement: boolean;
  requiredConsentFlags: string[];
  matchedIncidentTypes: string[];
  payloadPreview: {
    refNo: string;
    title: string;
    summary: string;
    language: string;
    jurisdiction: string;
    incidentType?: string;
    severity?: string;
    structuredFields: Record<string, unknown>;
    evidence: Array<Record<string, unknown>>;
  };
}
