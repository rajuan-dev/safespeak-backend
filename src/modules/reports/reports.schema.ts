import { z } from 'zod';

import {
  REPORT_SEVERITIES,
  REPORT_STATUSES,
  REPORT_SUBMISSION_ANONYMITY_MODES,
  REPORT_SUBMISSION_STATUSES
} from './reports.constants';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

export const reportParamsSchema = z.object({
  id: objectIdSchema
});

export const conversationSessionParamsSchema = z.object({
  conversationSessionId: objectIdSchema
});

const structuredFieldsSchema = z
  .object({
    who: z.string().max(2000).optional(),
    what: z.string().max(5000).optional(),
    when: z.string().max(500).optional(),
    where: z.string().max(1000).optional(),
    how: z.string().max(3000).optional(),
    witnesses: z.string().max(2000).optional(),
    repeatedIncidents: z.boolean().optional(),
    injuries: z.string().max(2000).optional(),
    supportMessage: z.string().max(2000).optional(),
    evidenceItems: z.array(z.unknown()).optional()
  })
  .strict();

export const createReportSchema = z
  .object({
    language: z.string().min(2).max(12).default('en'),
    jurisdiction: z.string().min(2).max(80).default('NSW'),
    lga: z.string().max(120).optional(),
    context: z.string().max(2000).optional(),
    originalNarrative: z.string().max(20000).optional(),
    translatedNarrative: z.string().max(20000).optional(),
    incidentType: z.string().max(120).optional(),
    severity: z.enum(REPORT_SEVERITIES).optional(),
    structuredFields: structuredFieldsSchema.default({}),
    status: z.enum(REPORT_STATUSES).default('draft').optional()
  })
  .strict();

export const updateReportSchema = createReportSchema.partial();

export const createReportFromConversationSchema = z
  .object({
    reportId: objectIdSchema.optional()
  })
  .strict();

export const reportDestinationPreviewQuerySchema = z
  .object({
    destinationType: z.string().trim().max(120).optional(),
    jurisdiction: z.string().trim().max(80).optional()
  })
  .strict();

export const submitReportSchema = z
  .object({
    destinationId: objectIdSchema,
    anonymityMode: z.enum(REPORT_SUBMISSION_ANONYMITY_MODES).default('identified'),
    notes: z.string().trim().max(2000).optional(),
    confirmConsent: z.boolean().refine((value) => value, {
      message: 'Submission consent confirmation is required'
    })
  })
  .strict();

export const submissionPreviewSchema = z
  .object({
    destinationIds: z.array(objectIdSchema).min(1).max(10),
    anonymityMode: z.enum(REPORT_SUBMISSION_ANONYMITY_MODES).default('identified'),
    notes: z.string().trim().max(2000).optional()
  })
  .strict();

export const submissionParamsSchema = z.object({
  id: objectIdSchema,
  submissionId: objectIdSchema
});

export const acknowledgeSubmissionSchema = z
  .object({
    status: z.enum(REPORT_SUBMISSION_STATUSES).default('acknowledged'),
    externalReference: z.string().trim().min(1).max(200),
    acknowledgementMessage: z.string().trim().max(2000).optional(),
    acknowledgementPayload: z.record(z.unknown()).default({})
  })
  .strict();

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type CreateReportFromConversationInput = z.infer<
  typeof createReportFromConversationSchema
>;
export type ReportDestinationPreviewQueryInput = z.infer<
  typeof reportDestinationPreviewQuerySchema
>;
export type SubmitReportInput = z.infer<typeof submitReportSchema>;
export type SubmissionPreviewInput = z.infer<typeof submissionPreviewSchema>;
export type AcknowledgeSubmissionInput = z.infer<typeof acknowledgeSubmissionSchema>;
