import type {
  MICRO_EDUCATION_CHIPS,
  MICRO_EDUCATION_DURATIONS,
  MICRO_EDUCATION_FORMATS,
  MICRO_EDUCATION_INCIDENT_CATEGORIES,
  MICRO_EDUCATION_STATUSES,
  MICRO_EDUCATION_TONES
} from './microeducation.constants';

export type MicroEducationStatus = (typeof MICRO_EDUCATION_STATUSES)[number];
export type MicroEducationTone = (typeof MICRO_EDUCATION_TONES)[number];
export type MicroEducationChip = (typeof MICRO_EDUCATION_CHIPS)[number];
export type MicroEducationIncidentCategory =
  (typeof MICRO_EDUCATION_INCIDENT_CATEGORIES)[number];
export type MicroEducationDuration = (typeof MICRO_EDUCATION_DURATIONS)[number];
export type MicroEducationFormat = (typeof MICRO_EDUCATION_FORMATS)[number];

export interface MicroEducationServiceContext {
  actor?: {
    userId?: string;
  };
  ip?: string;
  userAgent?: string;
}
