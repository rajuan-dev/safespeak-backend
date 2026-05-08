import type { REPORT_SEVERITIES, REPORT_STATUSES } from './reports.constants';

export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];
export type ReportOwnerType = 'anonymous' | 'user';

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
