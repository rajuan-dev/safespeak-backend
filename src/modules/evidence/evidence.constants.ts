export const EVIDENCE_STATUSES = [
  'pending_upload',
  'draft',
  'local_only',
  'synced',
  'sync_failed',
  'delete_requested',
  'deleted'
] as const;

export const EVIDENCE_STORAGE_PROVIDERS = ['local_encrypted', 's3'] as const;

export const EVIDENCE_ACTIONS = {
  upload: 'evidence.upload',
  uploadUrlCreate: 'evidence.upload_url.create',
  completeUpload: 'evidence.complete_upload',
  cloudSync: 'evidence.cloud_sync',
  cloudSyncSkipped: 'evidence.cloud_sync_skipped',
  cloudSyncFailed: 'evidence.cloud_sync_failed',
  download: 'evidence.download',
  deleteRequest: 'evidence.request_delete',
  softDelete: 'evidence.delete',
  verifyHash: 'evidence.verify_hash'
} as const;
