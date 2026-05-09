import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  fullName: z.string().trim().min(1).max(120).optional()
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128)
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20)
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional()
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
