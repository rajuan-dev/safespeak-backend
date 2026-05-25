import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { PrivacyRequestModel } from '@modules/admin/admin.model';
import { ReportModel, ReportSubmissionModel } from '@modules/reports/reports.model';
import {
  AdvocateRequestModel,
  HelpSupportRequestModel,
  SafetyPlanModel,
  WarmReferralModel
} from '@modules/support/support.model';

import { USER_NOTIFICATION_ACTIONS } from './notifications.constants';
import { UserNotificationReadModel } from './notifications.model';
import type {
  MarkUserNotificationReadInput,
  MarkUserNotificationsReadInput,
  UserNotificationsQueryInput
} from './notifications.schema';
import type {
  UserNotificationContext,
  UserNotificationDraft,
  UserNotificationItem,
  UserNotificationSeverity
} from './notifications.types';

interface NotificationCopy {
  title: string;
  body: (subject: string) => string;
  severity: UserNotificationSeverity;
}

interface ReportNotificationSource {
  _id?: unknown;
  refNo?: unknown;
  status?: unknown;
  statusHistory?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}

interface ReportSubmissionNotificationSource {
  _id?: unknown;
  reportId?: unknown;
  destinationName?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  submittedAt?: unknown;
  acknowledgementReceivedAt?: unknown;
  lastAttemptAt?: unknown;
  deletedAt?: unknown;
}

interface PrivacyRequestNotificationSource {
  _id?: unknown;
  requestType?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface SupportNotificationSource {
  _id?: unknown;
  title?: unknown;
  serviceName?: unknown;
  serviceId?: unknown;
  advocateType?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface SafetyPlanNotificationSource {
  _id?: unknown;
  title?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
}

const SOURCE_LIMIT_FLOOR = 20;

const REPORT_STATUS_COPY: Record<string, NotificationCopy> = {
  draft: {
    title: 'Report draft saved',
    body: (subject) => `${subject} is saved as a draft.`,
    severity: 'info'
  },
  local_only: {
    title: 'Report saved locally',
    body: (subject) => `${subject} is stored for your records only.`,
    severity: 'info'
  },
  ready_for_review: {
    title: 'Report ready for review',
    body: (subject) => `${subject} is ready to review before sharing.`,
    severity: 'info'
  },
  triaged: {
    title: 'Report triaged',
    body: (subject) => `${subject} has been triaged for next steps.`,
    severity: 'success'
  },
  info_only: {
    title: 'Report kept for information',
    body: (subject) => `${subject} is marked as information only.`,
    severity: 'info'
  },
  pending_submission: {
    title: 'Report waiting to submit',
    body: (subject) => `${subject} is waiting for destination submission.`,
    severity: 'warning'
  },
  submitted: {
    title: 'Report submitted',
    body: (subject) => `${subject} has been submitted.`,
    severity: 'success'
  },
  received: {
    title: 'Report received',
    body: (subject) => `${subject} has been acknowledged as received.`,
    severity: 'success'
  },
  withdrawn: {
    title: 'Report withdrawn',
    body: (subject) => `${subject} has been withdrawn.`,
    severity: 'warning'
  },
  closed: {
    title: 'Report closed',
    body: (subject) => `${subject} has been closed.`,
    severity: 'success'
  }
};

const SUBMISSION_STATUS_COPY: Record<string, NotificationCopy> = {
  draft_preview: {
    title: 'Submission preview ready',
    body: (subject) => `A delivery preview is ready for ${subject}.`,
    severity: 'info'
  },
  queued: {
    title: 'Report delivery queued',
    body: (subject) => `Your report is queued for ${subject}.`,
    severity: 'info'
  },
  submitted: {
    title: 'Report sent',
    body: (subject) => `Your report was sent to ${subject}.`,
    severity: 'success'
  },
  acknowledged: {
    title: 'Report acknowledged',
    body: (subject) => `${subject} acknowledged your report.`,
    severity: 'success'
  },
  requires_manual_action: {
    title: 'Submission needs review',
    body: (subject) => `Review the information needed before sending to ${subject}.`,
    severity: 'warning'
  },
  config_missing: {
    title: 'Delivery setup needed',
    body: (subject) => `SafeSpeak prepared your report for ${subject}, but partner delivery is not configured yet.`,
    severity: 'warning'
  },
  withdrawn: {
    title: 'Submission withdrawn',
    body: (subject) => `The submission to ${subject} was withdrawn.`,
    severity: 'warning'
  },
  failed: {
    title: 'Report delivery failed',
    body: (subject) => `We could not send your report to ${subject}. Review it and try again.`,
    severity: 'critical'
  }
};

const PRIVACY_STATUS_COPY: Record<string, NotificationCopy> = {
  pending: {
    title: 'Privacy request received',
    body: (subject) => `Your ${subject} request is waiting for review.`,
    severity: 'info'
  },
  in_review: {
    title: 'Privacy request in review',
    body: (subject) => `Your ${subject} request is being reviewed.`,
    severity: 'warning'
  },
  completed: {
    title: 'Privacy request completed',
    body: (subject) => `Your ${subject} request has been completed.`,
    severity: 'success'
  },
  rejected: {
    title: 'Privacy request update',
    body: (subject) => `Your ${subject} request could not be completed as submitted.`,
    severity: 'warning'
  }
};

const SUPPORT_STATUS_COPY: Record<string, NotificationCopy> = {
  pending: {
    title: 'Support request received',
    body: (subject) => `Your ${subject} is waiting for review.`,
    severity: 'info'
  },
  accepted: {
    title: 'Support request accepted',
    body: (subject) => `Your ${subject} has been accepted.`,
    severity: 'success'
  },
  completed: {
    title: 'Support request completed',
    body: (subject) => `Your ${subject} has been completed.`,
    severity: 'success'
  },
  cancelled: {
    title: 'Support request cancelled',
    body: (subject) => `Your ${subject} has been cancelled.`,
    severity: 'warning'
  }
};

const toObjectId = (userId: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication token is required');
  }

  return new Types.ObjectId(userId);
};

const toSafeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  return undefined;
};

const toSafeDate = (value: unknown): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
};

const getFallbackDate = (...values: unknown[]): Date => {
  for (const value of values) {
    const date = toSafeDate(value);

    if (date) {
      return date;
    }
  }

  return new Date();
};

const humanizeIdentifier = (value: string): string =>
  value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatShortDate = (date: Date): string =>
  new Intl.DateTimeFormat('en-AU', {
    month: 'short',
    day: '2-digit'
  }).format(date);

const formatNotificationTimestamp = (date: Date): string =>
  `${new Intl.DateTimeFormat('en-AU', { weekday: 'short' }).format(date)}, ${formatShortDate(date)} - ${new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date)}`;

const formatNotificationDateLabel = (date: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round((today - dateOnly) / 86_400_000);

  if (dayDelta === 0) {
    return `Today - ${formatShortDate(date)}`;
  }

  if (dayDelta === 1) {
    return `Yesterday - ${formatShortDate(date)}`;
  }

  if (dayDelta <= 7) {
    return `Earlier this week - ${formatShortDate(date)}`;
  }

  return formatShortDate(date);
};

const getStatusHistoryDate = (
  statusHistory: unknown,
  status: string
): Date | undefined => {
  if (!Array.isArray(statusHistory)) {
    return undefined;
  }

  for (let index = statusHistory.length - 1; index >= 0; index -= 1) {
    const item = statusHistory[index] as { status?: unknown; changedAt?: unknown };

    if (item.status === status) {
      return toSafeDate(item.changedAt);
    }
  }

  return undefined;
};

const getStartOfToday = (): Date => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const notificationSort = (left: UserNotificationDraft, right: UserNotificationDraft): number =>
  right.createdAt.getTime() - left.createdAt.getTime();

const matchesView = (notification: UserNotificationItem, view: UserNotificationsQueryInput['view']) => {
  if (view === 'all') {
    return true;
  }

  const startOfToday = getStartOfToday();

  if (view === 'today') {
    return notification.createdAt >= startOfToday;
  }

  return notification.createdAt < startOfToday;
};

const audit = async (
  context: UserNotificationContext,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: 'user',
    actorId: context.userId,
    action,
    resourceType: 'system',
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

const withReadState = async (
  userId: Types.ObjectId,
  drafts: UserNotificationDraft[]
): Promise<UserNotificationItem[]> => {
  const notificationIds = drafts.map((item) => item.id);
  const readRecords = await UserNotificationReadModel.find({
    userId,
    notificationId: { $in: notificationIds }
  })
    .select('notificationId readAt')
    .lean();
  const readById = new Map(readRecords.map((record) => [record.notificationId, record.readAt]));

  return drafts.map((item) => {
    const readAt = readById.get(item.id);

    return {
      ...item,
      timestamp: formatNotificationTimestamp(item.createdAt),
      dateLabel: formatNotificationDateLabel(item.createdAt),
      unread: !readAt,
      readAt
    };
  });
};

export const buildReportStatusNotification = (
  report: ReportNotificationSource
): UserNotificationDraft | undefined => {
  const sourceId = toSafeString(report._id);
  const status = typeof report.status === 'string' ? report.status : undefined;
  const copy = status ? REPORT_STATUS_COPY[status] : undefined;

  if (!sourceId || !status || !copy || toSafeDate(report.deletedAt)) {
    return undefined;
  }

  const reportLabel =
    typeof report.refNo === 'string' && report.refNo.trim()
      ? `Report ${report.refNo.trim()}`
      : 'Your report';
  const createdAt =
    getStatusHistoryDate(report.statusHistory, status) ??
    getFallbackDate(report.updatedAt, report.createdAt);

  return {
    id: `report:${sourceId}:status:${status}`,
    title: copy.title,
    body: copy.body(reportLabel),
    type: 'report_status',
    severity: copy.severity,
    createdAt,
    sourceType: 'report',
    sourceId,
    actionLabel: 'View report',
    actionHref: `/dashboard?view=reportoverview&reportId=${encodeURIComponent(sourceId)}`,
    metadata: { status }
  };
};

export const buildReportSubmissionNotification = (
  submission: ReportSubmissionNotificationSource
): UserNotificationDraft | undefined => {
  const sourceId = toSafeString(submission._id);
  const reportId = toSafeString(submission.reportId);
  const status = typeof submission.status === 'string' ? submission.status : undefined;
  const copy = status ? SUBMISSION_STATUS_COPY[status] : undefined;

  if (!sourceId || !status || !copy || toSafeDate(submission.deletedAt)) {
    return undefined;
  }

  const destinationName =
    typeof submission.destinationName === 'string' && submission.destinationName.trim()
      ? submission.destinationName.trim()
      : 'the selected destination';
  const createdAt = getFallbackDate(
    submission.acknowledgementReceivedAt,
    submission.submittedAt,
    submission.lastAttemptAt,
    submission.updatedAt,
    submission.createdAt
  );
  const actionHref = reportId
    ? `/dashboard?view=reportsubmissionshare&reportId=${encodeURIComponent(reportId)}`
    : '/dashboard?view=reportsubmissionhistory';

  return {
    id: `submission:${sourceId}:status:${status}`,
    title: copy.title,
    body: copy.body(destinationName),
    type: 'report_delivery',
    severity: copy.severity,
    createdAt,
    sourceType: 'report_submission',
    sourceId,
    actionLabel:
      status === 'requires_manual_action' || status === 'config_missing'
        ? 'Review submission'
        : 'View submission',
    actionHref,
    metadata: {
      status,
      reportId
    }
  };
};

export const buildPrivacyRequestNotification = (
  request: PrivacyRequestNotificationSource
): UserNotificationDraft | undefined => {
  const sourceId = toSafeString(request._id);
  const status = typeof request.status === 'string' ? request.status : undefined;
  const copy = status ? PRIVACY_STATUS_COPY[status] : undefined;

  if (!sourceId || !status || !copy) {
    return undefined;
  }

  const requestType =
    typeof request.requestType === 'string' && request.requestType.trim()
      ? humanizeIdentifier(request.requestType).toLowerCase()
      : 'privacy';

  return {
    id: `privacy:${sourceId}:status:${status}`,
    title: copy.title,
    body: copy.body(requestType),
    type: 'privacy_request',
    severity: copy.severity,
    createdAt: getFallbackDate(request.updatedAt, request.createdAt),
    sourceType: 'privacy_request',
    sourceId,
    actionLabel: 'Review privacy',
    actionHref: '/dashboard/settings?view=privacy',
    metadata: {
      status,
      requestType
    }
  };
};

const buildSupportStatusNotification = (
  source: SupportNotificationSource,
  options: {
    idPrefix: string;
    sourceType: UserNotificationDraft['sourceType'];
    subject: string;
    actionHref: string;
  }
): UserNotificationDraft | undefined => {
  const sourceId = toSafeString(source._id);
  const status = typeof source.status === 'string' ? source.status : undefined;
  const copy = status ? SUPPORT_STATUS_COPY[status] : undefined;

  if (!sourceId || !status || !copy) {
    return undefined;
  }

  return {
    id: `${options.idPrefix}:${sourceId}:status:${status}`,
    title: copy.title,
    body: copy.body(options.subject),
    type: 'support_request',
    severity: copy.severity,
    createdAt: getFallbackDate(source.updatedAt, source.createdAt),
    sourceType: options.sourceType,
    sourceId,
    actionLabel: 'View support',
    actionHref: options.actionHref,
    metadata: { status }
  };
};

export const buildWarmReferralNotification = (
  referral: SupportNotificationSource
): UserNotificationDraft | undefined => {
  const serviceName =
    typeof referral.serviceName === 'string' && referral.serviceName.trim()
      ? referral.serviceName.trim()
      : toSafeString(referral.serviceId) ?? 'support service';

  return buildSupportStatusNotification(referral, {
    idPrefix: 'warm-referral',
    sourceType: 'warm_referral',
    subject: `warm referral to ${serviceName}`,
    actionHref: '/dashboard?view=resources'
  });
};

export const buildAdvocateRequestNotification = (
  request: SupportNotificationSource
): UserNotificationDraft | undefined => {
  const advocateType =
    typeof request.advocateType === 'string' && request.advocateType.trim()
      ? humanizeIdentifier(request.advocateType).toLowerCase()
      : 'advocate';

  return buildSupportStatusNotification(request, {
    idPrefix: 'advocate-request',
    sourceType: 'advocate_request',
    subject: `${advocateType} request`,
    actionHref: '/dashboard?view=resources'
  });
};

export const buildHelpSupportRequestNotification = (
  request: SupportNotificationSource
): UserNotificationDraft | undefined =>
  buildSupportStatusNotification(request, {
    idPrefix: 'help-support',
    sourceType: 'help_support_request',
    subject: 'help request',
    actionHref: '/dashboard/settings?view=support'
  });

export const buildSafetyPlanNotification = (
  safetyPlan: SafetyPlanNotificationSource
): UserNotificationDraft | undefined => {
  const sourceId = toSafeString(safetyPlan._id);

  if (!sourceId || safetyPlan.isActive === false) {
    return undefined;
  }

  const title =
    typeof safetyPlan.title === 'string' && safetyPlan.title.trim()
      ? safetyPlan.title.trim()
      : 'Safety plan';

  return {
    id: `safety-plan:${sourceId}:created`,
    title: 'Safety plan saved',
    body: `${title} is available from your dashboard.`,
    type: 'safety_plan',
    severity: 'success',
    createdAt: getFallbackDate(safetyPlan.createdAt),
    sourceType: 'safety_plan',
    sourceId,
    actionLabel: 'View safety plan',
    actionHref: '/dashboard?view=safetyplan'
  };
};

export const listUserNotifications = async (
  context: UserNotificationContext,
  query: UserNotificationsQueryInput
): Promise<{
  notifications: UserNotificationItem[];
  unreadCount: number;
  totalCount: number;
}> => {
  const userId = toObjectId(context.userId);
  const sourceLimit = Math.max(query.limit, SOURCE_LIMIT_FLOOR);
  const [
    reports,
    submissions,
    privacyRequests,
    warmReferrals,
    advocateRequests,
    helpRequests,
    safetyPlans
  ] = await Promise.all([
    ReportModel.find({ userId, ownerType: 'user', deletedAt: { $exists: false } })
      .select('refNo status statusHistory createdAt updatedAt deletedAt')
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean(),
    ReportSubmissionModel.find({ userId, ownerType: 'user', deletedAt: { $exists: false } })
      .select(
        'reportId destinationName status createdAt updatedAt submittedAt acknowledgementReceivedAt lastAttemptAt deletedAt'
      )
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean(),
    PrivacyRequestModel.find({ userId })
      .select('requestType status createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean(),
    WarmReferralModel.find({ userId })
      .select('serviceId serviceName status createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean(),
    AdvocateRequestModel.find({ userId })
      .select('advocateType status createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean(),
    HelpSupportRequestModel.find({ userId })
      .select('title status createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean(),
    SafetyPlanModel.find({ userId })
      .select('title isActive createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .lean()
  ]);
  const drafts = [
    ...reports.map(buildReportStatusNotification),
    ...submissions.map(buildReportSubmissionNotification),
    ...privacyRequests.map(buildPrivacyRequestNotification),
    ...warmReferrals.map(buildWarmReferralNotification),
    ...advocateRequests.map(buildAdvocateRequestNotification),
    ...helpRequests.map(buildHelpSupportRequestNotification),
    ...safetyPlans.map(buildSafetyPlanNotification)
  ]
    .filter((item): item is UserNotificationDraft => Boolean(item))
    .sort(notificationSort);
  const notificationsWithReadState = await withReadState(userId, drafts);
  const filteredNotifications = notificationsWithReadState
    .filter((item) => matchesView(item, query.view))
    .filter((item) => !query.unreadOnly || item.unread)
    .slice(0, query.limit);
  const unreadCount = notificationsWithReadState.filter((item) => item.unread).length;

  await audit(context, USER_NOTIFICATION_ACTIONS.list, {
    count: filteredNotifications.length,
    unreadCount,
    view: query.view,
    unreadOnly: query.unreadOnly
  });

  return {
    notifications: filteredNotifications,
    unreadCount,
    totalCount: notificationsWithReadState.length
  };
};

export const markUserNotificationRead = async (
  context: UserNotificationContext,
  input: MarkUserNotificationReadInput
): Promise<{ notificationId: string; readAt: Date }> => {
  const userId = toObjectId(context.userId);
  const readAt = new Date();

  await UserNotificationReadModel.updateOne(
    {
      userId,
      notificationId: input.notificationId
    },
    {
      $set: { readAt }
    },
    { upsert: true }
  );

  await audit(context, USER_NOTIFICATION_ACTIONS.read, {
    notificationId: input.notificationId
  });

  return {
    notificationId: input.notificationId,
    readAt
  };
};

export const markUserNotificationsRead = async (
  context: UserNotificationContext,
  input: MarkUserNotificationsReadInput
): Promise<{ notificationIds: string[]; readAt: Date }> => {
  const userId = toObjectId(context.userId);
  const notificationIds = Array.from(new Set(input.notificationIds));
  const readAt = new Date();

  await UserNotificationReadModel.bulkWrite(
    notificationIds.map((notificationId) => ({
      updateOne: {
        filter: {
          userId,
          notificationId
        },
        update: {
          $set: { readAt }
        },
        upsert: true
      }
    }))
  );

  await audit(context, USER_NOTIFICATION_ACTIONS.readAll, {
    count: notificationIds.length
  });

  return {
    notificationIds,
    readAt
  };
};
