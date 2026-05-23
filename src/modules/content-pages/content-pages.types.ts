import type { Types } from 'mongoose';

import type { CONTENT_PAGE_KEYS } from './content-pages.constants';

export type ContentPageKey = (typeof CONTENT_PAGE_KEYS)[number];

export type LandingPageContent = {
  heroHeadline: string;
  subheading: string;
  primaryButtonLabel: string;
  primaryButtonUrl: string;
  secondaryButtonLabel?: string;
  secondaryButtonUrl?: string;
  backgroundVisualsEnabled: boolean;
};

export type LegalDocumentContent = {
  contentHtml: string;
  imageOriginalFileName?: string;
};

export type AboutPageContent = {
  eyebrow: string;
  title: string;
  body: string;
  commitments: string[];
};

export type ContentPagePayloadByKey = {
  'landing-page': LandingPageContent;
  'privacy-policy': LegalDocumentContent;
  'terms-conditions': LegalDocumentContent;
  'about-us': AboutPageContent;
};

export type ContentPageContent = ContentPagePayloadByKey[ContentPageKey];

export type ContentPageServiceContext = {
  actor?: {
    userId?: string;
  };
  ip?: string;
  userAgent?: string;
};

export type ContentPageActorFields = {
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
};
