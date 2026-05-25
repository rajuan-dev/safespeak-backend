import { Schema, model, type Types } from 'mongoose';

export interface UserNotificationReadDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  notificationId: string;
  readAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userNotificationReadSchema = new Schema<UserNotificationReadDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    notificationId: {
      type: String,
      required: true,
      trim: true
    },
    readAt: {
      type: Date,
      required: true,
      default: Date.now
    }
  },
  { timestamps: true }
);

userNotificationReadSchema.index({ userId: 1, notificationId: 1 }, { unique: true });

export const UserNotificationReadModel = model<UserNotificationReadDocument>(
  'UserNotificationRead',
  userNotificationReadSchema
);
