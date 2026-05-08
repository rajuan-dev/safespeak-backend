import type { EVIDENCE_STATUSES, EVIDENCE_STORAGE_PROVIDERS } from './evidence.constants';

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type EvidenceStorageProvider = (typeof EVIDENCE_STORAGE_PROVIDERS)[number];

export interface EvidenceOwner {
  userId?: string;
  sessionId?: string;
}

export interface StoredEvidenceFile {
  path: string;
  iv: string;
  authTag: string;
}

export interface EvidenceUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
