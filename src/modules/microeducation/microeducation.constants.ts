export const MICRO_EDUCATION_STATUSES = ['draft', 'published'] as const;

export const MICRO_EDUCATION_TONES = [
  'blue',
  'orange',
  'green',
  'amber',
  'violet',
  'teal'
] as const;

export const MICRO_EDUCATION_CHIPS = [
  'harassment',
  'rights',
  'safety',
  'mentalHealth'
] as const;

export const MICRO_EDUCATION_DURATIONS = ['quick', 'deep'] as const;

export const MICRO_EDUCATION_FORMATS = ['video', 'interactive', 'guide'] as const;

export const MICRO_EDUCATION_ACTIONS = {
  listPublic: 'microeducation.list_public',
  listAdmin: 'admin.microeducation.list',
  create: 'admin.microeducation.create',
  update: 'admin.microeducation.update',
  delete: 'admin.microeducation.delete'
} as const;
