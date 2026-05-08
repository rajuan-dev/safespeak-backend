export const DEFAULT_PROFILE_LANGUAGE = 'en';
export const DEFAULT_PROFILE_JURISDICTION = 'NSW';

export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'bn', label: 'Bangla' },
  { code: 'hi', label: 'Hindi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zh', label: 'Chinese' }
] as const;

export const CULTURAL_PROFILE_OPTIONS = [
  'Aboriginal and Torres Strait Islander',
  'African Australian',
  'Arab Australian',
  'South Asian Australian',
  'Southeast Asian Australian',
  'Prefer not to say'
] as const;

export const FAITH_PROFILE_OPTIONS = [
  'Buddhist',
  'Christian',
  'Hindu',
  'Jewish',
  'Muslim',
  'Sikh',
  'No religion',
  'Prefer not to say'
] as const;

export const COMMUNITY_PROFILE_OPTIONS = [
  'Migrant',
  'Refugee or asylum seeker',
  'International student',
  'LGBTQIA+',
  'Disability community',
  'Prefer not to say'
] as const;
