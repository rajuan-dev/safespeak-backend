export const CONTENT_RESOURCE_STATUSES = ['draft', 'published', 'archived'] as const;

export const CONTENT_RESOURCE_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'video/mp4'
] as const;

export const CONTENT_RESOURCE_ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
] as const;

export const CONTENT_RESOURCE_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const CONTENT_RESOURCE_ACTIONS = {
  listPublic: 'content_resources.list_public',
  listAdmin: 'admin.content_resources.list',
  getAdmin: 'admin.content_resources.get',
  create: 'admin.content_resources.create',
  update: 'admin.content_resources.update',
  delete: 'admin.content_resources.delete',
  download: 'content_resources.download'
} as const;
