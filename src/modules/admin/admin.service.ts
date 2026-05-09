import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { UserModel } from '@modules/auth/auth.model';
import { hashPassword } from '@modules/auth/auth.utils';
import { createAuditLog } from '@modules/audit/audit.service';
import { getAnalyticsOverview } from '@modules/analytics/analytics.service';
import type { AnalyticsQueryInput } from '@modules/analytics/analytics.schema';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import { ReportModel } from '@modules/reports/reports.model';

import { ADMIN_ACTIONS } from './admin.constants';
import { AdminDestinationModel, AdminTaxonomyModel, PrivacyRequestModel } from './admin.model';
import type {
  DestinationInput,
  DestinationQueryInput,
  CreateAdminUserInput,
  PrivacyRequestQueryInput,
  TaxonomyInput,
  TaxonomyQueryInput,
  UpdateDestinationInput,
  UpdatePrivacyRequestInput,
  UpdateTaxonomyInput,
  UsersQueryInput
} from './admin.schema';
import type { AdminServiceContext } from './admin.types';

const audit = async (
  context: AdminServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: 'admin',
    actorId: context.actor.userId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

export const getAdminDashboard = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const [users, reports, knowledgeSources, privacyRequests] = await Promise.all([
    UserModel.countDocuments({ deletedAt: { $exists: false } }),
    ReportModel.countDocuments({ deletedAt: { $exists: false } }),
    RagKnowledgeSourceModel.countDocuments({ deletedAt: { $exists: false } }),
    PrivacyRequestModel.countDocuments({ status: { $in: ['pending', 'in_review'] } })
  ]);

  await audit(context, ADMIN_ACTIONS.dashboard);

  return {
    users,
    reports,
    knowledgeSources,
    openPrivacyRequests: privacyRequests
  };
};

export const listUsers = async (
  context: AdminServiceContext,
  query: UsersQueryInput
): Promise<unknown[]> => {
  const filter = {
    deletedAt: { $exists: false },
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          $or: [
            { email: { $regex: query.search, $options: 'i' } },
            { fullName: { $regex: query.search, $options: 'i' } }
          ]
        }
      : {})
  };
  const users = await UserModel.find(filter)
    .select('-passwordHash -refreshTokenHash')
    .limit(query.limit)
    .lean();

  await audit(context, ADMIN_ACTIONS.usersList, undefined, { count: users.length });

  return users;
};

export const createAdminUser = async (
  context: AdminServiceContext,
  input: CreateAdminUserInput
): Promise<unknown> => {
  const existingUser = await UserModel.findOne({ email: input.email.toLowerCase() });

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email is already registered');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    email: input.email.toLowerCase(),
    fullName: input.fullName,
    passwordHash,
    role: input.role,
    status: 'active',
    isEmailVerified: true
  });

  await audit(context, ADMIN_ACTIONS.userCreate, user._id.toString(), {
    role: input.role
  });

  return UserModel.findById(user._id).select('-passwordHash -refreshTokenHash').lean();
};

export const listTaxonomies = async (
  context: AdminServiceContext,
  query: TaxonomyQueryInput
): Promise<unknown[]> => {
  const taxonomies = await AdminTaxonomyModel.find({
    ...(query.type ? { type: query.type } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
  })
    .sort({ type: 1, label: 1 })
    .lean();

  await audit(context, ADMIN_ACTIONS.taxonomiesList, undefined, { count: taxonomies.length });

  return taxonomies;
};

export const createTaxonomy = async (
  context: AdminServiceContext,
  input: TaxonomyInput
): Promise<unknown> => {
  const taxonomy = await AdminTaxonomyModel.create(input);
  await audit(context, ADMIN_ACTIONS.taxonomyCreate, taxonomy._id.toString(), { type: input.type });

  return taxonomy;
};

export const updateTaxonomy = async (
  context: AdminServiceContext,
  id: string,
  input: UpdateTaxonomyInput
): Promise<unknown> => {
  const taxonomy = await AdminTaxonomyModel.findById(id);

  if (!taxonomy) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Taxonomy not found');
  }

  taxonomy.set(input);
  await taxonomy.save();
  await audit(context, ADMIN_ACTIONS.taxonomyUpdate, taxonomy._id.toString(), {
    changedFields: Object.keys(input)
  });

  return taxonomy;
};

export const listDestinations = async (
  context: AdminServiceContext,
  query: DestinationQueryInput
): Promise<unknown[]> => {
  const destinations = await AdminDestinationModel.find({
    ...(query.type ? { type: query.type } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
  })
    .sort({ type: 1, name: 1 })
    .lean();

  await audit(context, ADMIN_ACTIONS.destinationsList, undefined, { count: destinations.length });

  return destinations;
};

export const createDestination = async (
  context: AdminServiceContext,
  input: DestinationInput
): Promise<unknown> => {
  const destination = await AdminDestinationModel.create(input);
  await audit(context, ADMIN_ACTIONS.destinationCreate, destination._id.toString(), {
    type: input.type
  });

  return destination;
};

export const updateDestination = async (
  context: AdminServiceContext,
  id: string,
  input: UpdateDestinationInput
): Promise<unknown> => {
  const destination = await AdminDestinationModel.findById(id);

  if (!destination) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Destination not found');
  }

  destination.set(input);
  await destination.save();
  await audit(context, ADMIN_ACTIONS.destinationUpdate, destination._id.toString(), {
    changedFields: Object.keys(input)
  });

  return destination;
};

export const listKnowledgeSourcesForAdmin = async (
  context: AdminServiceContext
): Promise<unknown[]> => {
  const sources = await RagKnowledgeSourceModel.find({ deletedAt: { $exists: false } })
    .sort({ updatedAt: -1 })
    .lean();

  await audit(context, ADMIN_ACTIONS.knowledgeSourcesList, undefined, { count: sources.length });

  return sources;
};

export const listPrivacyRequests = async (
  context: AdminServiceContext,
  query: PrivacyRequestQueryInput
): Promise<unknown[]> => {
  const requests = await PrivacyRequestModel.find({
    ...(query.status ? { status: query.status } : {})
  })
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

  await audit(context, ADMIN_ACTIONS.privacyRequestsList, undefined, { count: requests.length });

  return requests;
};

export const updatePrivacyRequest = async (
  context: AdminServiceContext,
  id: string,
  input: UpdatePrivacyRequestInput
): Promise<unknown> => {
  const privacyRequest = await PrivacyRequestModel.findById(id);

  if (!privacyRequest) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Privacy request not found');
  }

  privacyRequest.status = input.status;
  privacyRequest.notes = input.notes;
  privacyRequest.reviewedBy = context.actor.userId as never;
  privacyRequest.reviewedAt = new Date();
  await privacyRequest.save();
  await audit(context, ADMIN_ACTIONS.privacyRequestUpdate, privacyRequest._id.toString(), {
    status: input.status
  });

  return privacyRequest;
};

export const getAdminAnalyticsOverview = async (
  context: AdminServiceContext,
  query: AnalyticsQueryInput
): Promise<Record<string, unknown>> => {
  const overview = await getAnalyticsOverview(context, query);

  await audit(context, ADMIN_ACTIONS.analyticsOverview);

  return overview;
};
