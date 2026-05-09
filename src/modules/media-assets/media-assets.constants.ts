export const MEDIA_ASSET_STATUSES = ['draft', 'published', 'archived'] as const;

export const MEDIA_ASSET_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

export const MEDIA_ASSET_ACTIONS = {
  listPublic: 'media_assets.list_public',
  listAdmin: 'admin.media_assets.list',
  getAdmin: 'admin.media_assets.get',
  create: 'admin.media_assets.create',
  update: 'admin.media_assets.update',
  delete: 'admin.media_assets.delete',
  view: 'media_assets.view'
} as const;
