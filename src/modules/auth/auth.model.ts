import { Schema, model } from 'mongoose';

import { USER_ROLES, USER_STATUSES } from './auth.constants';
import type { UserRole, UserStatus } from '@modules/rbac/rbac.types';

export interface UserDocument {
  email: string;
  passwordHash: string;
  fullName: string;
  googleId?: string;
  authProvider: 'local' | 'google';
  avatarUrl?: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  lastLoginAt?: Date;
  refreshTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    googleId: {
      type: String,
      trim: true,
      required: false
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
      required: true
    },
    avatarUrl: {
      type: String,
      trim: true,
      required: false
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'public_user',
      required: true
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'active',
      required: true
    },
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    lastLoginAt: {
      type: Date,
      required: false
    },
    refreshTokenHash: {
      type: String,
      select: false,
      required: false
    },
    deletedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ role: 1, status: 1 });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

export const UserModel = model<UserDocument>('User', userSchema);
