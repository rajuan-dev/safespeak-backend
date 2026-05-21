import type {
  ADMIN_CULTURAL_PROFILE_STATUSES,
  ADMIN_CULTURAL_PROFILE_TYPES,
  ADMIN_DESTINATION_CHANNELS,
  ADMIN_DESTINATION_TYPES,
  ADMIN_SUBMISSION_TEMPLATE_ACK_MODES,
  ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES,
  ADMIN_TAXONOMY_TYPES,
  PRIVACY_REQUEST_STATUSES
} from './admin.constants';

export type AdminCulturalProfileType = (typeof ADMIN_CULTURAL_PROFILE_TYPES)[number];
export type AdminCulturalProfileStatus = (typeof ADMIN_CULTURAL_PROFILE_STATUSES)[number];
export type AdminTaxonomyType = (typeof ADMIN_TAXONOMY_TYPES)[number];
export type AdminDestinationType = (typeof ADMIN_DESTINATION_TYPES)[number];
export type AdminDestinationChannel = (typeof ADMIN_DESTINATION_CHANNELS)[number];
export type AdminSubmissionTemplateAckMode =
  (typeof ADMIN_SUBMISSION_TEMPLATE_ACK_MODES)[number];
export type AdminSubmissionTemplateAttachmentMode =
  (typeof ADMIN_SUBMISSION_TEMPLATE_ATTACHMENT_MODES)[number];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export interface AdminServiceContext {
  actor: {
    userId: string;
  };
  ip?: string;
  userAgent?: string;
}
