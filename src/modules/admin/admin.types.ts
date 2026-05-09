import type {
  ADMIN_DESTINATION_TYPES,
  ADMIN_TAXONOMY_TYPES,
  PRIVACY_REQUEST_STATUSES
} from './admin.constants';

export type AdminTaxonomyType = (typeof ADMIN_TAXONOMY_TYPES)[number];
export type AdminDestinationType = (typeof ADMIN_DESTINATION_TYPES)[number];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export interface AdminServiceContext {
  actor: {
    userId: string;
  };
  ip?: string;
  userAgent?: string;
}
