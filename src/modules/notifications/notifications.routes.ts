import { Router } from 'express';

import { authenticateUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  listUserNotificationsController,
  markUserNotificationReadController,
  markUserNotificationsReadController
} from './notifications.controller';
import {
  markUserNotificationReadSchema,
  markUserNotificationsReadSchema,
  userNotificationsQuerySchema
} from './notifications.schema';

export const notificationsRoutes = Router();

notificationsRoutes.use(authenticateUser);

notificationsRoutes.get(
  '/',
  validate({ query: userNotificationsQuerySchema }),
  listUserNotificationsController
);
notificationsRoutes.post(
  '/read',
  validate({ body: markUserNotificationReadSchema }),
  markUserNotificationReadController
);
notificationsRoutes.post(
  '/read-all',
  validate({ body: markUserNotificationsReadSchema }),
  markUserNotificationsReadController
);
