import { Router } from 'express';

import { authenticateUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  adminLoginController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController
} from './auth.controller';
import { loginSchema, refreshTokenSchema, registerSchema } from './auth.schema';

export const authRoutes = Router();

authRoutes.post('/register', validate({ body: registerSchema }), registerController);
authRoutes.post('/login', validate({ body: loginSchema }), loginController);
authRoutes.post('/admin/login', validate({ body: loginSchema }), adminLoginController);
authRoutes.post('/refresh', validate({ body: refreshTokenSchema }), refreshController);
authRoutes.post('/logout', authenticateUser, logoutController);
authRoutes.get('/me', authenticateUser, meController);
