import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

export const evidenceParamsSchema = z.object({
  id: objectIdSchema
});

export const reportEvidenceParamsSchema = z.object({
  reportId: objectIdSchema
});

const metadataSchema = z.record(z.unknown()).default({});
const formMetadataSchema = z.preprocess((value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, metadataSchema);

export const createUploadUrlSchema = z
  .object({
    reportId: objectIdSchema,
    type: z.string().min(1).max(80),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().positive(),
    metadata: metadataSchema.optional()
  })
  .strict();

export const completeUploadBodySchema = z
  .object({
    evidenceId: objectIdSchema,
    sha256Hash: z.string().regex(/^[a-f\d]{64}$/i),
    metadata: formMetadataSchema.optional()
  })
  .strict();

export const verifyHashBodySchema = z
  .object({
    sha256Hash: z.string().regex(/^[a-f\d]{64}$/i)
  })
  .strict();

export const transcribeEvidenceBodySchema = z
  .object({
    language: z.string().trim().min(2).max(40).optional(),
    saveTranscript: z.boolean().default(true),
    reportId: objectIdSchema.optional(),
    useAsNarrative: z.boolean().default(false)
  })
  .strict();

export type CreateUploadUrlInput = z.infer<typeof createUploadUrlSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadBodySchema>;
export type VerifyHashInput = z.infer<typeof verifyHashBodySchema>;
export type TranscribeEvidenceInput = z.infer<typeof transcribeEvidenceBodySchema>;
