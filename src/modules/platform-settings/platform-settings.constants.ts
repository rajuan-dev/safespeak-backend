export const PLATFORM_SETTINGS_KEY = 'default';

export const PLATFORM_SETTINGS_ACTIONS = {
  getPublic: 'platform_settings.get_public',
  getAdmin: 'admin.platform_settings.get',
  updateDraft: 'admin.platform_settings.update_draft',
  publish: 'admin.platform_settings.publish'
} as const;

export const DEFAULT_PLATFORM_SETTINGS = {
  safety: {
    immediateDangerText: 'If you are in immediate danger, call 000 now.',
    respectSupportText: "If it's safe, contact 1800RESPECT (24/7).",
    platformRoleText:
      'SafeSpeak is an information and triage tool. It is not a crisis, legal, counselling, medical, or case-management service.',
    informationOnlyText: 'All SafeSpeak content is information-only and is not legal advice.',
    emergencyCallLabel: 'Emergency Call (000)',
    respectCallLabel: '1800RESPECT call',
    quickExitLabel: 'Quick Exit',
    covertModeLabel: 'Covert mode ready'
  },
  consent: {
    introText:
      'You control what SafeSpeak stores, processes, and shares. No data is stored or forwarded without your consent.',
    localStorageLabel: 'Store data locally',
    cloudSyncLabel: 'Sync to cloud',
    agencySharingLabel: 'Share with agencies',
    analyticsLabel: 'Use anonymised data for analytics'
  },
  ai: {
    disclaimerText:
      'This output is information-only and must not be treated as legal, medical, counselling, crisis, or case-management advice.',
    humanReviewText: 'AI-generated content may require human review before use in formal reports.'
  }
} as const;
