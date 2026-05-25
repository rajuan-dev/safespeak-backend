import { z } from 'zod';

import { USER_NOTIFICATION_VIEWS } from './notifications.constants';

const notificationIdSchema = z.string().trim().min(1).max(220);
const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
  .default(false);

export const userNotificationsQuerySchema = z.object({
  view: z.enum(USER_NOTIFICATION_VIEWS).default('all'),
  unreadOnly: booleanQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const markUserNotificationReadSchema = z.object({
  notificationId: notificationIdSchema
});

export const markUserNotificationsReadSchema = z.object({
  notificationIds: z.array(notificationIdSchema).min(1).max(100)
});

export type UserNotificationsQueryInput = z.infer<typeof userNotificationsQuerySchema>;
export type MarkUserNotificationReadInput = z.infer<typeof markUserNotificationReadSchema>;
export type MarkUserNotificationsReadInput = z.infer<typeof markUserNotificationsReadSchema>;
