import { Router } from 'express';

import { authenticateUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminLoginController,
  deactivateController,
  googleCallbackController,
  googleLoginController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController
} from './auth.controller';
import {
  deactivateAccountSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema
} from './auth.schema';

export const authRoutes = Router();
export const googleAuthRoutes = Router();

const registerGoogleAuthRoutes = (router: Router): void => {
  router.get('/google', googleLoginController);
  router.get('/google/callback', googleCallbackController);
};

registerGoogleAuthRoutes(authRoutes);
registerGoogleAuthRoutes(googleAuthRoutes);

authRoutes.post('/register', validate({ body: registerSchema }), registerController);
authRoutes.post('/login', validate({ body: loginSchema }), loginController);
authRoutes.post('/admin/login', validate({ body: loginSchema }), adminLoginController);
authRoutes.post('/refresh', validate({ body: refreshTokenSchema }), refreshController);
authRoutes.post('/logout', authenticateUser, logoutController);
authRoutes.get('/me', authenticateUser, meController);
authRoutes.post(
  '/deactivate',
  authenticateUser,
  validate({ body: deactivateAccountSchema }),
  deactivateController
);
