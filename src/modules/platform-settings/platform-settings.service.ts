import { Types } from 'mongoose';

import { createAuditLog } from '@modules/audit/audit.service';

import {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTINGS_ACTIONS,
  PLATFORM_SETTINGS_KEY
} from './platform-settings.constants';
import {
  PlatformSettingsModel,
  type PlatformSettingsHydratedDocument
} from './platform-settings.model';
import type { UpdatePlatformSettingsDraftInput } from './platform-settings.schema';
import type {
  PlatformSettingsPayload,
  PlatformSettingsServiceContext
} from './platform-settings.types';

const toObjectId = (value?: string) =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;

const mergeSettings = (
  current: PlatformSettingsPayload,
  input: UpdatePlatformSettingsDraftInput
): PlatformSettingsPayload => ({
  safety: {
    ...current.safety,
    ...input.safety
  },
  consent: {
    ...current.consent,
    ...input.consent
  },
  ai: {
    ...current.ai,
    ...input.ai
  }
});

const withDefaultSettings = (settings?: Partial<PlatformSettingsPayload>): PlatformSettingsPayload => ({
  safety: {
    ...DEFAULT_PLATFORM_SETTINGS.safety,
    ...settings?.safety
  },
  consent: {
    ...DEFAULT_PLATFORM_SETTINGS.consent,
    ...settings?.consent
  },
  ai: {
    ...DEFAULT_PLATFORM_SETTINGS.ai,
    ...settings?.ai
  }
});

const serializePublicSettings = (settings: PlatformSettingsHydratedDocument) => ({
  settings: withDefaultSettings(settings.published),
  version: settings.version,
  publishedAt: settings.publishedAt,
  updatedAt: settings.updatedAt
});

const serializeAdminSettings = (settings: PlatformSettingsHydratedDocument) => ({
  draft: withDefaultSettings(settings.draft),
  published: withDefaultSettings(settings.published),
  version: settings.version,
  publishedAt: settings.publishedAt,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt
});

const auditPlatformSettingsAction = async (
  context: PlatformSettingsServiceContext,
  action: string,
  metadata?: Record<string, unknown>
) => {
  await createAuditLog({
    actorType: context.actor?.userId ? 'admin' : 'system',
    actorId: context.actor?.userId,
    action,
    resourceType: 'system',
    resourceId: undefined,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: {
      settingsKey: PLATFORM_SETTINGS_KEY,
      ...metadata
    }
  });
};

const getOrCreatePlatformSettings = async (
  context?: PlatformSettingsServiceContext
): Promise<PlatformSettingsHydratedDocument> => {
  const existing = await PlatformSettingsModel.findOne({ key: PLATFORM_SETTINGS_KEY });

  if (existing) {
    const draft = withDefaultSettings(existing.draft);
    const published = withDefaultSettings(existing.published);

    if (JSON.stringify(existing.draft) !== JSON.stringify(draft)) {
      existing.draft = draft;
    }

    if (JSON.stringify(existing.published) !== JSON.stringify(published)) {
      existing.published = published;
    }

    if (existing.isModified()) {
      await existing.save();
    }

    return existing;
  }

  return PlatformSettingsModel.create({
    key: PLATFORM_SETTINGS_KEY,
    draft: DEFAULT_PLATFORM_SETTINGS,
    published: DEFAULT_PLATFORM_SETTINGS,
    createdBy: toObjectId(context?.actor?.userId),
    updatedBy: toObjectId(context?.actor?.userId),
    publishedAt: new Date()
  });
};

export const getPublicPlatformSettings = async (context: PlatformSettingsServiceContext) => {
  const settings = await getOrCreatePlatformSettings(context);

  return serializePublicSettings(settings);
};

export const getAdminPlatformSettings = async (context: PlatformSettingsServiceContext) => {
  const settings = await getOrCreatePlatformSettings(context);

  await auditPlatformSettingsAction(context, PLATFORM_SETTINGS_ACTIONS.getAdmin, {
    version: settings.version
  });

  return serializeAdminSettings(settings);
};

export const updatePlatformSettingsDraft = async (
  context: PlatformSettingsServiceContext,
  input: UpdatePlatformSettingsDraftInput
) => {
  const settings = await getOrCreatePlatformSettings(context);
  const changedSections = Object.keys(input);

  settings.set({
    draft: mergeSettings(settings.draft, input),
    updatedBy: toObjectId(context.actor?.userId)
  });
  await settings.save();

  await auditPlatformSettingsAction(context, PLATFORM_SETTINGS_ACTIONS.updateDraft, {
    changedSections
  });

  return serializeAdminSettings(settings);
};

export const publishPlatformSettingsDraft = async (context: PlatformSettingsServiceContext) => {
  const settings = await getOrCreatePlatformSettings(context);

  settings.set({
    published: settings.draft,
    version: settings.version + 1,
    updatedBy: toObjectId(context.actor?.userId),
    publishedBy: toObjectId(context.actor?.userId),
    publishedAt: new Date()
  });
  await settings.save();

  await auditPlatformSettingsAction(context, PLATFORM_SETTINGS_ACTIONS.publish, {
    version: settings.version
  });

  return serializeAdminSettings(settings);
};
