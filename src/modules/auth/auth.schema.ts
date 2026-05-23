import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid reset request');
const passwordResetAudienceSchema = z.enum(['admin', 'public']).default('admin');

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

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128)
});

export const updateCurrentUserProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
    contactNo: z.string().trim().max(80).optional()
  })
  .strict();

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
  audience: passwordResetAudienceSchema
});

export const verifyPasswordResetOtpSchema = z.object({
  email: z.string().email().max(254),
  audience: passwordResetAudienceSchema,
  resetRequestId: objectIdSchema,
  otp: z.string().regex(/^\d{4}$/, 'Enter the 4 digit verification code')
});

export const resetPasswordSchema = z.object({
  email: z.string().email().max(254),
  audience: passwordResetAudienceSchema,
  resetRequestId: objectIdSchema,
  resetToken: z.string().min(32).max(256),
  newPassword: z.string().min(8).max(128)
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional()
});

export const deactivateAccountSchema = z.object({
  confirmation: z.literal('DEACTIVATE')
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateCurrentUserProfileInput = z.infer<typeof updateCurrentUserProfileSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyPasswordResetOtpInput = z.infer<typeof verifyPasswordResetOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type PasswordResetAudience = z.infer<typeof passwordResetAudienceSchema>;
export type DeactivateAccountInput = z.infer<typeof deactivateAccountSchema>;
