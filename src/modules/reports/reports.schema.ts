import { z } from 'zod';

import { REPORT_SEVERITIES, REPORT_STATUSES } from './reports.constants';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

export const reportParamsSchema = z.object({
  id: objectIdSchema
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

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
