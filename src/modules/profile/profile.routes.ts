import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  getCommunityProfilesController,
  getCulturalProfilesController,
  getFaithProfilesController,
  getLanguagesController,
  getProfileController,
  updateProfileController
} from './profile.controller';
import { updateProfileSchema } from './profile.schema';

export const profileRoutes = Router();

profileRoutes.get('/languages', getLanguagesController);
profileRoutes.get('/cultural-profiles', getCulturalProfilesController);
profileRoutes.get('/faith-profiles', getFaithProfilesController);
profileRoutes.get('/community-profiles', getCommunityProfilesController);
profileRoutes.get('/profile', authenticateSessionOrUser, getProfileController);
profileRoutes.patch(
  '/profile',
  authenticateSessionOrUser,
  validate({ body: updateProfileSchema }),
  updateProfileController
);
