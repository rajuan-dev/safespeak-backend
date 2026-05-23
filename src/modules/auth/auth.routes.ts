import { Router } from 'express';

import { authenticateUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminLoginController,
  changePasswordController,
  deactivateController,
  forgotPasswordController,
  googleCallbackController,
  googleLoginController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
  resetPasswordController,
  updateMeController,
  verifyPasswordResetOtpController
} from './auth.controller';
import {
  changePasswordSchema,
  deactivateAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  updateCurrentUserProfileSchema,
  verifyPasswordResetOtpSchema
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
authRoutes.post('/forgot-password', validate({ body: forgotPasswordSchema }), forgotPasswordController);
authRoutes.post(
  '/verify-reset-otp',
  validate({ body: verifyPasswordResetOtpSchema }),
  verifyPasswordResetOtpController
);
authRoutes.post('/reset-password', validate({ body: resetPasswordSchema }), resetPasswordController);
authRoutes.post('/logout', authenticateUser, logoutController);
authRoutes.post(
  '/change-password',
  authenticateUser,
  validate({ body: changePasswordSchema }),
  changePasswordController
);
authRoutes.get('/me', authenticateUser, meController);
authRoutes.patch(
  '/me',
  authenticateUser,
  validate({ body: updateCurrentUserProfileSchema }),
  updateMeController
);
authRoutes.post(
  '/deactivate',
  authenticateUser,
  validate({ body: deactivateAccountSchema }),
  deactivateController
);
