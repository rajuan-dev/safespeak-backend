import { Types } from 'mongoose';

import { createAuditLog } from '@modules/audit/audit.service';

import {
  CONTENT_PAGE_ACTIONS,
  DEFAULT_CONTENT_PAGES,
  LEGACY_LEGAL_DOCUMENT_MARKER
} from './content-pages.constants';
import {
  ContentPageModel,
  type ContentPageHydratedDocument
} from './content-pages.model';
import type {
  ContentPagePublishInput,
  ContentPageUpdateInput
} from './content-pages.schema';
import {
  aboutPageContentSchema,
  landingPageContentSchema,
  legalDocumentContentSchema
} from './content-pages.schema';
import type {
  ContentPageKey,
  ContentPagePayloadByKey,
  ContentPageServiceContext
} from './content-pages.types';

const CONTENT_PAGE_SCHEMAS = {
  'landing-page': landingPageContentSchema,
  'privacy-policy': legalDocumentContentSchema,
  'terms-conditions': legalDocumentContentSchema,
  'about-us': aboutPageContentSchema
} as const;

const LEGAL_DOCUMENT_KEYS = new Set<ContentPageKey>([
  'privacy-policy',
  'terms-conditions'
]);

const toObjectId = (value?: string) =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;

const cloneContent = <TContent>(content: TContent): TContent =>
  JSON.parse(JSON.stringify(content)) as TContent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isLegalDocumentKey = (key: ContentPageKey): boolean => LEGAL_DOCUMENT_KEYS.has(key);

const isLegacyLegalDocumentHtml = (value: unknown): boolean =>
  typeof value === 'string' && value.includes(LEGACY_LEGAL_DOCUMENT_MARKER);

const defaultContentForKey = <TKey extends ContentPageKey>(
  key: TKey
): ContentPagePayloadByKey[TKey] =>
  cloneContent(DEFAULT_CONTENT_PAGES[key]) as unknown as ContentPagePayloadByKey[TKey];

const parseContentForKey = <TKey extends ContentPageKey>(
  key: TKey,
  content: unknown
): ContentPagePayloadByKey[TKey] =>
  CONTENT_PAGE_SCHEMAS[key].parse(content) as ContentPagePayloadByKey[TKey];

const withDefaultContent = <TKey extends ContentPageKey>(
  key: TKey,
  content: unknown
): ContentPagePayloadByKey[TKey] => {
  const currentContent = isRecord(content) ? content : {};
  const defaultContent = defaultContentForKey(key) as Record<string, unknown>;
  const mergedContent: Record<string, unknown> = {
    ...defaultContent,
    ...currentContent
  };

  if (isLegalDocumentKey(key) && isLegacyLegalDocumentHtml(mergedContent.contentHtml)) {
    mergedContent.contentHtml = defaultContent.contentHtml;
  }

  return parseContentForKey(key, mergedContent);
};

const hasUnpublishedChanges = (page: ContentPageHydratedDocument): boolean =>
  JSON.stringify(withDefaultContent(page.key, page.draft)) !==
  JSON.stringify(withDefaultContent(page.key, page.published));

const serializePublicContentPage = (page: ContentPageHydratedDocument) => ({
  key: page.key,
  content: withDefaultContent(page.key, page.published),
  version: page.version,
  publishedAt: page.publishedAt,
  updatedAt: page.updatedAt
});

const serializeAdminContentPage = (page: ContentPageHydratedDocument) => ({
  key: page.key,
  draft: withDefaultContent(page.key, page.draft),
  published: withDefaultContent(page.key, page.published),
  version: page.version,
  publishedAt: page.publishedAt,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
  hasUnpublishedChanges: hasUnpublishedChanges(page)
});

const auditContentPageAction = async (
  context: ContentPageServiceContext,
  action: string,
  key: ContentPageKey,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.actor?.userId ? 'admin' : 'system',
    actorId: context.actor?.userId,
    action,
    resourceType: 'system',
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: {
      contentPageKey: key,
      ...metadata
    }
  });
};

const getOrCreateContentPage = async (
  key: ContentPageKey,
  context?: ContentPageServiceContext
): Promise<ContentPageHydratedDocument> => {
  const existing = await ContentPageModel.findOne({ key });

  if (existing) {
    const draft = withDefaultContent(key, existing.draft);
    const published = withDefaultContent(key, existing.published);
    let changed = false;

    if (JSON.stringify(existing.draft) !== JSON.stringify(draft)) {
      existing.draft = draft;
      changed = true;
    }

    if (JSON.stringify(existing.published) !== JSON.stringify(published)) {
      existing.published = published;
      changed = true;
    }

    if (changed) {
      await existing.save();
    }

    return existing;
  }

  const defaultContent = defaultContentForKey(key);

  return ContentPageModel.create({
    key,
    draft: defaultContent,
    published: defaultContent,
    createdBy: toObjectId(context?.actor?.userId),
    updatedBy: toObjectId(context?.actor?.userId),
    publishedAt: new Date()
  });
};

export const getPublicContentPage = async (
  context: ContentPageServiceContext,
  key: ContentPageKey
) => {
  const page = await getOrCreateContentPage(key, context);

  return serializePublicContentPage(page);
};

export const getAdminContentPage = async (
  context: ContentPageServiceContext,
  key: ContentPageKey
) => {
  const page = await getOrCreateContentPage(key, context);

  await auditContentPageAction(context, CONTENT_PAGE_ACTIONS.getAdmin, key, {
    version: page.version
  });

  return serializeAdminContentPage(page);
};

export const saveAdminContentPage = async (
  context: ContentPageServiceContext,
  key: ContentPageKey,
  input: ContentPageUpdateInput
) => {
  const page = await getOrCreateContentPage(key, context);
  const nextContent = withDefaultContent(key, {
    ...withDefaultContent(key, page.draft),
    ...input.content
  });

  page.set({
    draft: nextContent,
    version: page.version + 1,
    updatedBy: toObjectId(context.actor?.userId)
  });
  await page.save();

  await auditContentPageAction(context, CONTENT_PAGE_ACTIONS.save, key, {
    version: page.version,
    changedFields: Object.keys(input.content)
  });

  return serializeAdminContentPage(page);
};

export const publishAdminContentPage = async (
  context: ContentPageServiceContext,
  key: ContentPageKey,
  input: ContentPagePublishInput = {}
) => {
  const page = await getOrCreateContentPage(key, context);
  const draftContent = withDefaultContent(key, page.draft);
  const nextContent = input.content
    ? withDefaultContent(key, {
        ...draftContent,
        ...input.content
      })
    : draftContent;

  page.set({
    draft: nextContent,
    published: nextContent,
    version: page.version + 1,
    updatedBy: toObjectId(context.actor?.userId),
    publishedBy: toObjectId(context.actor?.userId),
    publishedAt: new Date()
  });
  await page.save();

  await auditContentPageAction(context, CONTENT_PAGE_ACTIONS.publish, key, {
    version: page.version,
    changedFields: input.content ? Object.keys(input.content) : []
  });

  return serializeAdminContentPage(page);
};
