export const RESOURCE_STATUSES = ['draft', 'published'] as const;

export const RESOURCE_ACTIONS = {
  listPublic: 'resources.list_public',
  listAdmin: 'admin.resources.list',
  create: 'admin.resources.create',
  update: 'admin.resources.update',
  delete: 'admin.resources.delete'
} as const;
