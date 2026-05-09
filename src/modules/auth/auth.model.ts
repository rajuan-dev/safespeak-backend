import { Schema, model } from 'mongoose';

import { USER_ROLES, USER_STATUSES } from './auth.constants';
import type { UserRole, UserStatus } from '@modules/rbac/rbac.types';

export interface UserDocument {
  email: string;
  passwordHash: string;
  fullName: string;
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

export const UserModel = model<UserDocument>('User', userSchema);
