import type { Request, Response } from 'express';

import { asyncHandler } from '@common/errors/asyncHandler';
import { ApiResponse } from '@common/responses/api-response';

import type {
  MarkUserNotificationReadInput,
  MarkUserNotificationsReadInput,
  UserNotificationsQueryInput
} from './notifications.schema';
import {
  listUserNotifications,
  markUserNotificationRead,
  markUserNotificationsRead
} from './notifications.service';

const getContext = (req: Request) => ({
  userId: req.user?.id ?? '',
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const listUserNotificationsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await listUserNotifications(
      getContext(req),
      req.query as unknown as UserNotificationsQueryInput
    );

    ApiResponse.success(res, 'Notifications retrieved', result);
  }
);

export const markUserNotificationReadController = asyncHandler(
  async (req: Request, res: Response) => {
    const readReceipt = await markUserNotificationRead(
      getContext(req),
      req.body as MarkUserNotificationReadInput
    );

    ApiResponse.success(res, 'Notification marked read', { readReceipt });
  }
);

export const markUserNotificationsReadController = asyncHandler(
  async (req: Request, res: Response) => {
    const readReceipt = await markUserNotificationsRead(
      getContext(req),
      req.body as MarkUserNotificationsReadInput
    );

    ApiResponse.success(res, 'Notifications marked read', { readReceipt });
  }
);
