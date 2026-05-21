import { Router } from 'express';

import { authenticateUser, requireAdminRole } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminPlatformSettingsController,
  adminPlatformSettingsDraftUpdateController,
  adminPlatformSettingsPublishController,
  publicPlatformSettingsController
} from './platform-settings.controller';
import { updatePlatformSettingsDraftSchema } from './platform-settings.schema';

export const platformSettingsRoutes = Router();
export const adminPlatformSettingsRoutes = Router();

platformSettingsRoutes.get('/', publicPlatformSettingsController);

adminPlatformSettingsRoutes.use(authenticateUser, requireAdminRole('super_admin', 'content_admin'));
adminPlatformSettingsRoutes.get('/', adminPlatformSettingsController);
adminPlatformSettingsRoutes.patch(
  '/draft',
  validate({ body: updatePlatformSettingsDraftSchema }),
  adminPlatformSettingsDraftUpdateController
);
adminPlatformSettingsRoutes.post('/publish', adminPlatformSettingsPublishController);
