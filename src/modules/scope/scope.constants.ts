export const SAFE_SPEAK_PRIORITY_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English', region: 'AU', priority: 'core' },
  { code: 'ar', label: 'Arabic', region: 'NSW', priority: 'phase_1' },
  { code: 'zh', label: 'Mandarin Chinese', region: 'NSW', priority: 'phase_1' },
  { code: 'yue', label: 'Cantonese', region: 'NSW', priority: 'phase_1' },
  { code: 'vi', label: 'Vietnamese', region: 'NSW', priority: 'phase_1' },
  { code: 'pa', label: 'Punjabi', region: 'NSW', priority: 'phase_1' },
  { code: 'hi', label: 'Hindi', region: 'NSW', priority: 'phase_1' },
  { code: 'ne', label: 'Nepali', region: 'NSW', priority: 'phase_1' },
  { code: 'el', label: 'Greek', region: 'NSW', priority: 'phase_1' },
  { code: 'bn', label: 'Bangla', region: 'AU', priority: 'extended' },
  { code: 'ur', label: 'Urdu', region: 'AU', priority: 'extended' },
  { code: 'es', label: 'Spanish', region: 'Global', priority: 'extended' }
] as const;

export const SAFE_SPEAK_JURISDICTIONS = [
  'NSW',
  'VIC',
  'QLD',
  'WA',
  'SA',
  'TAS',
  'ACT',
  'NT'
] as const;

export const SAFE_SPEAK_CONSENT_FLAGS = [
  'store_locally',
  'cloud_sync',
  'share_with_agencies',
  'use_anonymised_analytics',
  'process_with_ai',
  'transcribe_audio',
  'warm_referral',
  'manual_location'
] as const;

export const SAFE_SPEAK_CULTURAL_PROFILES = [
  'Aboriginal and Torres Strait Islander',
  'African Australian',
  'Arab Australian',
  'South Asian Australian',
  'Southeast Asian Australian',
  'East Asian Australian',
  'Pacific Islander Australian',
  'Jewish Community',
  'Multicultural Mixed Heritage',
  'Prefer not to say'
] as const;

export const SAFE_SPEAK_FAITH_PROFILES = [
  'Buddhist',
  'Christian',
  'Hindu',
  'Jewish',
  'Muslim',
  'Sikh',
  'No religion',
  'Spiritual but not religious',
  'Prefer not to say'
] as const;

export const SAFE_SPEAK_COMMUNITY_PROFILES = [
  'Migrant',
  'Refugee or asylum seeker',
  'International student',
  'Temporary visa holder',
  'Permanent resident',
  'LGBTQIA+',
  'Disability community',
  'Youth',
  'Senior',
  'Prefer not to say'
] as const;

export const SAFE_SPEAK_INCIDENT_TYPES = [
  'public_racial_abuse',
  'workplace_discrimination',
  'school_bullying',
  'online_harassment',
  'hate_speech',
  'racial_vilification',
  'workplace_misconduct',
  'education_complaint',
  'cyber_scam',
  'phishing',
  'identity_theft',
  'financial_fraud',
  'community_safety_concern',
  'support_only'
] as const;

export const SAFE_SPEAK_SUPPORT_NEEDS = [
  'emergency_contact',
  'legal_information',
  'community_legal_centre',
  'counselling_directory',
  'community_advocate',
  'safety_planning',
  'interpreter_guidance',
  'crisis_resources',
  'financial_counselling'
] as const;

export const SAFE_SPEAK_DESTINATION_TYPES = [
  'police',
  'anti_discrimination_agency',
  'esafety',
  'legal_aid',
  'community_legal_centre',
  'education_provider',
  'workplace_channel',
  'scamwatch',
  'reportcyber',
  'community_support_org'
] as const;

export const SAFE_SPEAK_DESTINATION_CHANNELS = [
  'api_oauth',
  'api_mtls',
  'secure_email_pgp',
  'secure_email',
  'manual_export_pdf',
  'manual_export_json',
  'booking_link'
] as const;

export const SAFE_SPEAK_REPORT_STATUSES = [
  'draft',
  'local_only',
  'ready_for_review',
  'submitted',
  'received',
  'closed',
  'info_only',
  'withdrawn',
  'deleted'
] as const;

export const SAFE_SPEAK_SCAM_ANALYSIS_TYPES = [
  'text',
  'email',
  'screenshot',
  'url'
] as const;

export const SAFE_SPEAK_MICRO_EDUCATION_CATEGORIES = [
  'school_bullying',
  'racial_abuse_at_school',
  'online_harassment',
  'platform_reporting',
  'workplace_misconduct',
  'nsw_racial_hatred_offence',
  'interpreter_use',
  'scams_101'
] as const;

export const SAFE_SPEAK_ANALYTICS_POLICY = {
  minimumCellSuppression: 5,
  requiresDifferentialPrivacyForExternalExports: true,
  aggregationLevel: 'LGA',
  timeBuckets: ['weekly', 'monthly']
} as const;

export const SAFE_SPEAK_SCOPE_VERSION = '2026-05-12-scope-alignment-v1';
