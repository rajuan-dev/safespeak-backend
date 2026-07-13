export const CONSENT_FLAGS = [
  'store_local',
  'cloud_sync',
  'share_with_agencies',
  'use_anonymised_analytics',
  'process_with_ai',
  'transcribe_audio',
  'translate_content',
  'retain_evidence',
  'warm_referral',
  'advocate_request'
] as const;

export const DEFAULT_CONSENT_FLAGS = {
  store_local: true,
  cloud_sync: false,
  share_with_agencies: false,
  use_anonymised_analytics: false,
  process_with_ai: false,
  transcribe_audio: false,
  translate_content: false,
  retain_evidence: false,
  warm_referral: false,
  advocate_request: false
} as const;
