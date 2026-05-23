import { StatusCodes } from 'http-status-codes';
import type { FilterQuery } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { UserModel } from '@modules/auth/auth.model';
import { createAuditLog } from '@modules/audit/audit.service';

import { FEEDBACK_ACTIONS } from './feedback.constants';
import { FeedbackModel, type FeedbackDocument } from './feedback.model';
import type {
  AdminFeedbackQueryInput,
  FeedbackSubmissionInput,
  UpdateAdminFeedbackInput
} from './feedback.schema';
import type {
  AdminFeedbackServiceContext,
  FeedbackServiceContext,
  FeedbackSource,
  FeedbackStatus
} from './feedback.types';

type FeedbackUserRecord = {
  _id?: unknown;
  fullName?: unknown;
  email?: unknown;
  contactNo?: unknown;
  createdAt?: unknown;
};

type AdminFeedbackRecord = {
  _id?: string;
  id?: string;
  userId?: string;
  sessionId?: string;
  name: string;
  email: string;
  phone: string;
  joinedDate: string;
  subject?: string;
  message: string;
  rating?: number;
  source: FeedbackSource;
  status: FeedbackStatus;
  adminNotes?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

const audit = async (
  context: FeedbackServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

const auditAdmin = async (
  context: AdminFeedbackServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: 'admin',
    actorId: context.adminUserId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

const requireOwner = (context: FeedbackServiceContext): void => {
  if (!context.owner.userId && !context.owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }
};

const toRecord = (value: FeedbackDocument | Record<string, unknown>): Record<string, unknown> => {
  const documentLike = value as { toObject?: () => Record<string, unknown> };

  return typeof documentLike.toObject === 'function'
    ? documentLike.toObject()
    : (value as Record<string, unknown>);
};

const toSafeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    const stringifier = (value as { toString?: unknown }).toString;

    if (typeof stringifier === 'function') {
      const stringValue = (value as { toString: () => string }).toString();
      return stringValue === '[object Object]' ? undefined : stringValue;
    }
  }

  return undefined;
};

const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
};

const getStringField = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];

  return typeof value === 'string' && value.trim() ? value : undefined;
};

const formatDate = (date?: Date): string => {
  if (!date) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en-AU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

const getUserField = (user: FeedbackUserRecord | undefined, field: keyof FeedbackUserRecord) => {
  const value = user?.[field];

  return typeof value === 'string' && value.trim() ? value : undefined;
};

const toAdminFeedbackRecord = (
  feedback: FeedbackDocument | Record<string, unknown>,
  user?: FeedbackUserRecord
): AdminFeedbackRecord => {
  const record = toRecord(feedback);
  const id = toSafeString(record._id);
  const userId = toSafeString(record.userId);
  const sessionId = toSafeString(record.sessionId);
  const userCreatedAt = toDate(user?.createdAt);
  const createdAt = toDate(record.createdAt);
  const updatedAt = toDate(record.updatedAt);
  const reviewedAt = toDate(record.reviewedAt);

  return {
    _id: id,
    id,
    userId,
    sessionId,
    name: getStringField(record, 'name') ?? getUserField(user, 'fullName') ?? 'SafeSpeak user',
    email: getStringField(record, 'email') ?? getUserField(user, 'email') ?? 'Not provided',
    phone: getStringField(record, 'phone') ?? getUserField(user, 'contactNo') ?? 'Not provided',
    joinedDate: formatDate(userCreatedAt ?? createdAt),
    subject: getStringField(record, 'subject'),
    message: getStringField(record, 'message') ?? '',
    rating: typeof record.rating === 'number' ? record.rating : undefined,
    source: (getStringField(record, 'source') ?? 'user_feedback') as FeedbackSource,
    status: (getStringField(record, 'status') ?? 'new') as FeedbackStatus,
    adminNotes: getStringField(record, 'adminNotes'),
    reviewedBy: toSafeString(record.reviewedBy),
    reviewedAt,
    createdAt,
    updatedAt
  };
};

const toFeedbackReceipt = (feedback: FeedbackDocument) => ({
  id: feedback._id.toString(),
  status: feedback.status,
  createdAt: feedback.createdAt
});

const loadUsersForFeedback = async (
  feedbackRecords: Array<FeedbackDocument | Record<string, unknown>>
): Promise<Map<string, FeedbackUserRecord>> => {
  const userIds = feedbackRecords
    .map((record) => toSafeString(toRecord(record).userId))
    .filter((value): value is string => Boolean(value));

  if (userIds.length === 0) {
    return new Map();
  }

  const users = await UserModel.find({ _id: { $in: Array.from(new Set(userIds)) } })
    .select('fullName email contactNo createdAt')
    .lean();

  return new Map(users.map((user) => [String(user._id), user as FeedbackUserRecord]));
};

export const createFeedback = async (
  context: FeedbackServiceContext,
  input: FeedbackSubmissionInput
): Promise<{ id: string; status: FeedbackStatus; createdAt: Date }> => {
  requireOwner(context);
  const user = context.owner.userId
    ? await UserModel.findById(context.owner.userId)
        .select('fullName email contactNo')
        .lean()
    : undefined;
  const feedback = await FeedbackModel.create({
    userId: context.owner.userId,
    sessionId: context.owner.sessionId,
    name: input.name ?? getUserField(user as FeedbackUserRecord | undefined, 'fullName'),
    email: input.email ?? getUserField(user as FeedbackUserRecord | undefined, 'email'),
    phone: input.phone ?? getUserField(user as FeedbackUserRecord | undefined, 'contactNo'),
    subject: input.subject,
    message: input.message,
    rating: input.rating,
    source: input.source,
    status: 'new',
    metadata: input.metadata
  });

  await audit(context, FEEDBACK_ACTIONS.create, feedback._id.toString(), {
    source: input.source,
    rating: input.rating
  });

  return toFeedbackReceipt(feedback);
};

export const listAdminFeedback = async (
  context: AdminFeedbackServiceContext,
  query: AdminFeedbackQueryInput
): Promise<AdminFeedbackRecord[]> => {
  const filter: FilterQuery<FeedbackDocument> = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.source ? { source: query.source } : {})
  };

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { email: { $regex: query.search, $options: 'i' } },
      { phone: { $regex: query.search, $options: 'i' } },
      { subject: { $regex: query.search, $options: 'i' } },
      { message: { $regex: query.search, $options: 'i' } }
    ];
  }

  const feedbackRecords = await FeedbackModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();
  const users = await loadUsersForFeedback(feedbackRecords);
  const records = feedbackRecords.map((feedback) =>
    toAdminFeedbackRecord(feedback, users.get(toSafeString(feedback.userId) ?? ''))
  );

  await auditAdmin(context, FEEDBACK_ACTIONS.adminList, undefined, {
    count: records.length,
    status: query.status,
    source: query.source
  });

  return records;
};

export const updateAdminFeedback = async (
  context: AdminFeedbackServiceContext,
  feedbackId: string,
  input: UpdateAdminFeedbackInput
): Promise<AdminFeedbackRecord> => {
  const feedback = await FeedbackModel.findById(feedbackId);

  if (!feedback) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Feedback not found');
  }

  if (input.status !== undefined) {
    feedback.status = input.status;
  }

  if (input.adminNotes !== undefined) {
    feedback.adminNotes = input.adminNotes;
  }

  feedback.reviewedBy = context.adminUserId as never;
  feedback.reviewedAt = new Date();
  await feedback.save();

  const users = await loadUsersForFeedback([feedback]);

  await auditAdmin(context, FEEDBACK_ACTIONS.adminUpdate, feedback._id.toString(), {
    status: feedback.status,
    changedFields: Object.keys(input)
  });

  return toAdminFeedbackRecord(feedback, users.get(feedback.userId?.toString() ?? ''));
};
