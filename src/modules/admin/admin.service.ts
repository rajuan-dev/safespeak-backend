import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { UserModel } from '@modules/auth/auth.model';
import { deriveFullNameFromEmail, hashPassword } from '@modules/auth/auth.utils';
import { createAuditLog } from '@modules/audit/audit.service';
import { AuditLogModel } from '@modules/audit/audit.model';
import {
  getAnalyticsCategories,
  getAnalyticsHeatmap,
  getAnalyticsLanguages,
  getAnalyticsOverview,
  getAnalyticsTrends
} from '@modules/analytics/analytics.service';
import type { AnalyticsQueryInput } from '@modules/analytics/analytics.schema';
import { ContentResourceModel } from '@modules/content-resources/content-resources.model';
import { env } from '@config/env';
import { EvidenceAuditChainModel } from '@modules/evidence/evidence-audit.model';
import { EvidenceModel } from '@modules/evidence/evidence.model';
import { hasS3Storage } from '@modules/evidence/evidence.storage';
import { AiInteractionModel } from '@modules/ai/ai.model';
import { AI_ACTIONS } from '@modules/ai/ai.constants';
import {
  ConversationFlowSessionModel,
  ConversationFlowTriageModel
} from '@modules/conversation-flow/conversation-flow.model';
import { MediaAssetModel } from '@modules/media-assets/media-assets.model';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';
import { RagChunkModel, RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import { ResourceModel } from '@modules/resources/resources.model';
import { ReportModel, ReportSubmissionModel } from '@modules/reports/reports.model';
import {
  buildTaxonomyMetadata,
  getTaxonomyCatalog
} from '@modules/taxonomies/taxonomies.service';

import { ADMIN_ACTIONS } from './admin.constants';
import {
  AdminCulturalProfileModel,
  AdminDestinationModel,
  AdminSubmissionTemplateModel,
  AdminTaxonomyModel,
  PrivacyRequestModel
} from './admin.model';
import type {
  CulturalProfileInput,
  CulturalProfileQueryInput,
  DestinationInput,
  DestinationQueryInput,
  CreateAdminUserInput,
  PrivacyRequestQueryInput,
  ReportDeliveryQueryInput,
  SubmissionTemplateInput,
  SubmissionTemplateQueryInput,
  TaxonomyInput,
  TaxonomyQueryInput,
  UpdateCulturalProfileInput,
  UpdateAdminUserInput,
  UpdateDestinationInput,
  UpdatePrivacyRequestInput,
  UpdateSubmissionTemplateInput,
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

type AnalyticsCountRow = {
  _id?: unknown;
  count?: unknown;
};

const formatCount = (value: number): string => value.toLocaleString('en-AU');

const getCountValue = (value: unknown): number => (typeof value === 'number' ? value : 0);

const toAnalyticsCountRows = (rows: unknown[]): AnalyticsCountRow[] =>
  rows.filter((row): row is AnalyticsCountRow => typeof row === 'object' && row !== null);

const getTopAnalyticsLabel = (rows: unknown[], fallback: string): string => {
  const [firstRow] = toAnalyticsCountRows(rows);

  if (!firstRow || firstRow._id === undefined || firstRow._id === null || firstRow._id === '') {
    return fallback;
  }

  return String(firstRow._id);
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
  const email = input.email.toLowerCase();
  const existingUser = await UserModel.findOne({ email });

  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email is already registered');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    email,
    fullName: input.fullName ?? deriveFullNameFromEmail(email),
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

export const updateAdminUser = async (
  context: AdminServiceContext,
  id: string,
  input: UpdateAdminUserInput
): Promise<unknown> => {
  const user = await UserModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin user not found');
  }

  if (input.fullName !== undefined) {
    user.fullName = input.fullName;
  }

  if (input.role !== undefined) {
    user.role = input.role;
  }

  if (input.status !== undefined) {
    user.status = input.status;
  }

  await user.save();
  await audit(context, ADMIN_ACTIONS.userUpdate, user._id.toString(), {
    changedFields: Object.keys(input)
  });

  return UserModel.findById(user._id).select('-passwordHash -refreshTokenHash').lean();
};

export const listTaxonomies = async (
  context: AdminServiceContext,
  query: TaxonomyQueryInput
): Promise<unknown[]> => {
  const taxonomies = await AdminTaxonomyModel.find({
    deletedAt: { $exists: false },
    ...(query.type ? { type: query.type } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
  })
    .sort({ type: 1, label: 1 })
    .lean();

  await audit(context, ADMIN_ACTIONS.taxonomiesList, undefined, { count: taxonomies.length });

  return taxonomies;
};

export const getTaxonomy = async (
  context: AdminServiceContext,
  id: string
): Promise<unknown> => {
  const taxonomy = await AdminTaxonomyModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  }).lean();

  if (!taxonomy) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Taxonomy not found');
  }

  await audit(context, ADMIN_ACTIONS.taxonomyGet, id, {
    type: taxonomy.type,
    key: taxonomy.key
  });

  return taxonomy;
};

export const createTaxonomy = async (
  context: AdminServiceContext,
  input: TaxonomyInput
): Promise<unknown> => {
  const metadata = buildTaxonomyMetadata(input);
  const existingTaxonomy = await AdminTaxonomyModel.findOne({
    type: input.type,
    key: input.key,
    deletedAt: { $exists: false }
  }).lean();

  if (existingTaxonomy) {
    throw new ApiError(StatusCodes.CONFLICT, 'This taxonomy key already exists for the selected type.', [
      {
        field: 'key',
        type: input.type,
        key: input.key,
        message: 'Use a different key, or update the existing taxonomy record.'
      }
    ]);
  }

  const deletedTaxonomy = await AdminTaxonomyModel.findOneAndUpdate(
    {
      type: input.type,
      key: input.key,
      deletedAt: { $exists: true }
    },
    {
      $set: {
        ...input,
        metadata
      },
      $unset: { deletedAt: '' }
    },
    { new: true }
  );

  if (deletedTaxonomy) {
    await audit(context, ADMIN_ACTIONS.taxonomyCreate, deletedTaxonomy._id.toString(), {
      type: input.type,
      restoredDeletedRecord: true
    });

    return deletedTaxonomy;
  }

  const taxonomy = await AdminTaxonomyModel.create({
    ...input,
    metadata
  });
  await audit(context, ADMIN_ACTIONS.taxonomyCreate, taxonomy._id.toString(), { type: input.type });

  return taxonomy;
};

export const updateTaxonomy = async (
  context: AdminServiceContext,
  id: string,
  input: UpdateTaxonomyInput
): Promise<unknown> => {
  const taxonomy = await AdminTaxonomyModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!taxonomy) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Taxonomy not found');
  }

  const shouldRefreshMetadata =
    input.metadata !== undefined
    || input.type !== undefined
    || input.key !== undefined
    || input.label !== undefined
    || input.description !== undefined
    || Object.keys(taxonomy.metadata ?? {}).length === 0;

  taxonomy.set({
    ...input,
    ...(shouldRefreshMetadata
      ? {
          metadata: buildTaxonomyMetadata({
            type: input.type ?? taxonomy.type,
            key: input.key ?? taxonomy.key,
            label: input.label ?? taxonomy.label,
            description: input.description ?? taxonomy.description,
            metadata: {
              ...(taxonomy.metadata ?? {}),
              ...(input.metadata ?? {})
            }
          })
        }
      : {})
  });
  await taxonomy.save();
  await audit(context, ADMIN_ACTIONS.taxonomyUpdate, taxonomy._id.toString(), {
    changedFields: Object.keys(input)
  });

  return taxonomy;
};

export const deleteTaxonomy = async (
  context: AdminServiceContext,
  id: string
): Promise<unknown> => {
  const taxonomy = await AdminTaxonomyModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!taxonomy) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Taxonomy not found');
  }

  taxonomy.isActive = false;
  taxonomy.deletedAt = new Date();
  await taxonomy.save();
  await audit(context, ADMIN_ACTIONS.taxonomyDelete, taxonomy._id.toString(), {
    type: taxonomy.type,
    key: taxonomy.key
  });

  return taxonomy;
};

export const listCulturalProfiles = async (
  context: AdminServiceContext,
  query: CulturalProfileQueryInput
): Promise<unknown[]> => {
  const filter: Record<string, unknown> = {
    deletedAt: { $exists: false },
    ...(query.communityType ? { communityType: query.communityType } : {}),
    ...(query.validationStatus ? { validationStatus: query.validationStatus } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          $or: [
            { key: { $regex: query.search, $options: 'i' } },
            { name: { $regex: query.search, $options: 'i' } },
            { responseGuidance: { $regex: query.search, $options: 'i' } }
          ]
        }
      : {})
  };
  const profiles = await AdminCulturalProfileModel.find(filter)
    .sort({ communityType: 1, name: 1 })
    .limit(query.limit)
    .lean();

  await audit(context, ADMIN_ACTIONS.culturalProfilesList, undefined, {
    count: profiles.length,
    communityType: query.communityType,
    validationStatus: query.validationStatus
  });

  return profiles;
};

export const createCulturalProfile = async (
  context: AdminServiceContext,
  input: CulturalProfileInput
): Promise<unknown> => {
  const existingProfile = await AdminCulturalProfileModel.findOne({
    key: input.key,
    deletedAt: { $exists: false }
  }).lean();

  if (existingProfile) {
    throw new ApiError(StatusCodes.CONFLICT, 'This cultural profile key already exists.', [
      {
        field: 'key',
        key: input.key,
        message: 'Use a different key, or update the existing cultural profile.'
      }
    ]);
  }

  const deletedProfile = await AdminCulturalProfileModel.findOneAndUpdate(
    {
      key: input.key,
      deletedAt: { $exists: true }
    },
    {
      $set: {
        ...input,
        reviewedAt: input.validationStatus === 'validated' ? new Date() : undefined,
        reviewedBy: input.validationStatus === 'validated' ? context.actor.userId : undefined
      },
      $unset: { deletedAt: '' }
    },
    { new: true }
  );

  if (deletedProfile) {
    await audit(context, ADMIN_ACTIONS.culturalProfileCreate, deletedProfile._id.toString(), {
      key: input.key,
      restoredDeletedRecord: true
    });

    return deletedProfile;
  }

  const profile = await AdminCulturalProfileModel.create({
    ...input,
    reviewedAt: input.validationStatus === 'validated' ? new Date() : undefined,
    reviewedBy: input.validationStatus === 'validated' ? context.actor.userId : undefined
  });
  await audit(context, ADMIN_ACTIONS.culturalProfileCreate, profile._id.toString(), {
    key: input.key,
    communityType: input.communityType,
    validationStatus: input.validationStatus
  });

  return profile;
};

export const updateCulturalProfile = async (
  context: AdminServiceContext,
  id: string,
  input: UpdateCulturalProfileInput
): Promise<unknown> => {
  const profile = await AdminCulturalProfileModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Cultural profile not found');
  }

  const validationChangedToValidated =
    input.validationStatus === 'validated' && profile.validationStatus !== 'validated';

  profile.set({
    ...input,
    ...(validationChangedToValidated
      ? {
          reviewedAt: new Date(),
          reviewedBy: context.actor.userId
        }
      : {})
  });
  await profile.save();
  await audit(context, ADMIN_ACTIONS.culturalProfileUpdate, profile._id.toString(), {
    changedFields: Object.keys(input)
  });

  return profile;
};

export const deleteCulturalProfile = async (
  context: AdminServiceContext,
  id: string
): Promise<unknown> => {
  const profile = await AdminCulturalProfileModel.findOne({
    _id: id,
    deletedAt: { $exists: false }
  });

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Cultural profile not found');
  }

  profile.isActive = false;
  profile.deletedAt = new Date();
  await profile.save();
  await audit(context, ADMIN_ACTIONS.culturalProfileDelete, profile._id.toString(), {
    key: profile.key,
    communityType: profile.communityType
  });

  return profile;
};

export const getCulturalProfilesOverview = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const baseFilter = { deletedAt: { $exists: false } };
  const [
    totalProfiles,
    activeProfiles,
    validatedProfiles,
    pendingProfiles,
    needsUpdateProfiles,
    archivedProfiles,
    culturalProfiles,
    faithProfiles,
    communityProfiles,
    languages,
    partnerReviewProfiles,
    publishedProfiles
  ] = await Promise.all([
    AdminCulturalProfileModel.countDocuments(baseFilter),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, isActive: true }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, validationStatus: 'validated' }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, validationStatus: 'pending_review' }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, validationStatus: 'needs_update' }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, validationStatus: 'archived' }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, communityType: 'cultural' }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, communityType: 'faith' }),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, communityType: 'community' }),
    AdminCulturalProfileModel.distinct('languages', baseFilter),
    AdminCulturalProfileModel.countDocuments({ ...baseFilter, partnerReviewRequired: true }),
    AdminCulturalProfileModel.countDocuments({
      ...baseFilter,
      isActive: true,
      validationStatus: 'validated'
    })
  ]);
  const validationQueue = pendingProfiles + needsUpdateProfiles;
  const activeValidatedPercent = percent(publishedProfiles, activeProfiles);

  await audit(context, ADMIN_ACTIONS.culturalProfilesOverview, undefined, {
    totalProfiles,
    activeProfiles,
    validatedProfiles,
    validationQueue,
    publishedProfiles
  });

  return {
    eyebrow: 'Platform Intelligence Engine',
    title: 'Cultural Profiles',
    description:
      'Manage community-sensitive response templates so the platform can adapt its tone, referrals, and educational content respectfully.',
    statusNote:
      'Cultural routing is backed by managed admin records and only active validated profiles are exposed to client workflows',
    stats: [
      {
        label: 'FAITH PATHWAYS',
        value: String(faithProfiles),
        helper:
          faithProfiles > 0
            ? `${faithProfiles} faith profile records are managed through admin review.`
            : 'Create faith profile records to manage community-specific expectations centrally.'
      },
      {
        label: 'LANGUAGE PREFERENCES',
        value: languages.length ? String(languages.length) : '0',
        helper:
          languages.length > 0
            ? `${languages.length} language codes are linked to cultural profile guidance.`
            : 'Add language codes to profiles so client choices and referrals can align.'
      },
      {
        label: 'COMMUNITY VALIDATION',
        value: validationQueue > 0 ? String(validationQueue) : 'Current',
        helper:
          validationQueue > 0
            ? `${pendingProfiles} pending review and ${needsUpdateProfiles} needing update.`
            : `${validatedProfiles} profiles are validated; ${archivedProfiles} archived.`
      },
      {
        label: 'RESPONSE ADAPTATION',
        value: activeProfiles > 0 ? `${activeValidatedPercent}%` : 'Ready',
        helper:
          activeProfiles > 0
            ? `${publishedProfiles}/${activeProfiles} active profiles are validated for client use.`
            : 'Create active profiles before client workflows can use managed guidance.'
      }
    ],
    modules: [
      {
        id: 'faith-communities',
        label: 'Faith Communities',
        status: faithProfiles > 0 ? 'Active' : 'Ready',
        summary: 'Maintain faith-based response expectations without hard-coding them into every workflow.',
        owner: 'Community Partnerships',
        cadence: 'With partner review',
        metric: `${faithProfiles} faith records managed`,
        highlights: [
          'Faith profiles can define pathway-specific response wording, referral preferences, and content notes.',
          `${partnerReviewProfiles} profiles currently require partner review before or during publication.`,
          'Only active validated records are exposed through public profile endpoints.'
        ]
      },
      {
        id: 'language-preferences',
        label: 'Language Preferences',
        status: languages.length > 0 ? 'Active' : 'Ready',
        summary: 'Model preferred language and communication needs to improve support quality and routing.',
        owner: 'Multilingual Operations',
        cadence: 'Monthly validation',
        metric: `${languages.length} linked language codes`,
        highlights: [
          `${languages.length ? languages.join(', ') : 'No'} language codes are currently linked to managed profiles.`,
          'Profile language metadata can be used with interpreter and support-service filtering.',
          'Language choices stay separate from sensitive cultural notes unless the user consents to sharing profile context.'
        ]
      },
      {
        id: 'community-customs',
        label: 'Community Customs',
        status: communityProfiles > 0 || culturalProfiles > 0 ? 'Ready' : 'Priority',
        summary: 'Store cultural context that influences communication style, support expectations, and escalation tone.',
        owner: 'Community Programs',
        cadence: 'Per partner feedback cycle',
        metric: `${culturalProfiles + communityProfiles} cultural/community records managed`,
        highlights: [
          `${culturalProfiles} cultural records and ${communityProfiles} community records exist.`,
          'Response guidance is stored in admin records and public output is sanitized for client workflows.',
          'Metadata is retained internally for review and audit without leaking through public endpoints.'
        ]
      },
      {
        id: 'response-adaptation',
        label: 'Response Adaptation',
        status: publishedProfiles > 0 ? 'Active' : 'Priority',
        summary: 'Tune trauma-informed messaging to the selected profile so support language stays safe and respectful.',
        owner: 'Content and Safety',
        cadence: 'Before content release',
        metric: `${publishedProfiles} profiles available to client workflows`,
        highlights: [
          'Client profile dropdowns can include admin-managed active validated records.',
          'Support workflows can match against managed profile names while keeping hidden notes internal.',
          'Educational and referral guidance can reuse the same public sanitized profile shape.'
        ]
      },
      {
        id: 'community-validation',
        label: 'Community Validation',
        status: validationQueue > 0 ? 'Priority' : 'Monitored',
        summary: 'Track partner feedback, approval state, and revision requests for culturally sensitive assets.',
        owner: 'Community Review Board',
        cadence: 'Quarterly or pre-launch',
        metric: `${validationQueue} records awaiting validation action`,
        highlights: [
          `${pendingProfiles} profiles are pending review and ${needsUpdateProfiles} need updates.`,
          'Validated records automatically store reviewer and timestamp details.',
          'Archived or inactive records are excluded from user-facing profile guidance.'
        ]
      }
    ],
    quickLinks: [
      {
        label: 'Taxonomies',
        to: '/admin/platform-intelligence/taxonomies-management',
        description: 'Keep broad taxonomy labels aligned with managed profile records.'
      },
      {
        label: 'Service Destinations',
        to: '/admin/platform-intelligence/service-destinations',
        description: 'Connect profile-aware guidance to referral and support destinations.'
      },
      {
        label: 'Language Packs',
        to: '/admin/platform-intelligence/language-packs',
        description: 'Coordinate translation and interpreter coverage with managed community profiles.'
      },
      {
        label: 'Educational Content',
        to: '/admin/content-management/educational-content',
        description: 'Use validated profile guidance when adapting public support content.'
      }
    ],
    watchlistTitle: 'Cultural Profile Governance',
    watchlist: [
      validationQueue > 0
        ? 'Some profile records are not validated yet; they will not be exposed to client workflows.'
        : 'Active profiles are validated before client-facing use.',
      publishedProfiles > 0
        ? `${publishedProfiles} active validated profiles are available for user profile choices and public guidance.`
        : 'No active validated profiles are currently available to client workflows.',
      'Do not store sensitive identity assumptions in public guidance; use internal metadata only for admin review.'
    ],
    footerNote:
      'Live values come from admin-managed cultural profile records. Public/client endpoints return only active validated profile names and sanitized guidance.'
  };
};

export const listDestinations = async (
  context: AdminServiceContext,
  query: DestinationQueryInput
): Promise<unknown[]> => {
  const destinations = await AdminDestinationModel.find({
    ...(query.type ? { type: query.type } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.jurisdiction ? { jurisdiction: query.jurisdiction } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
  })
    .sort({ type: 1, jurisdiction: 1, name: 1 })
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

export const listSubmissionTemplates = async (
  context: AdminServiceContext,
  query: SubmissionTemplateQueryInput
): Promise<unknown[]> => {
  const templates = await AdminSubmissionTemplateModel.find({
    ...(query.destinationType ? { destinationType: query.destinationType } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.jurisdiction ? { jurisdiction: query.jurisdiction } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
  })
    .sort({ destinationType: 1, jurisdiction: 1, name: 1 })
    .lean();

  await audit(context, ADMIN_ACTIONS.submissionTemplatesList, undefined, { count: templates.length });

  return templates;
};

export const createSubmissionTemplate = async (
  context: AdminServiceContext,
  input: SubmissionTemplateInput
): Promise<unknown> => {
  const template = await AdminSubmissionTemplateModel.create(input);
  await audit(context, ADMIN_ACTIONS.submissionTemplateCreate, template._id.toString(), {
    key: input.key,
    destinationType: input.destinationType,
    channel: input.channel
  });

  return template;
};

export const updateSubmissionTemplate = async (
  context: AdminServiceContext,
  id: string,
  input: UpdateSubmissionTemplateInput
): Promise<unknown> => {
  const template = await AdminSubmissionTemplateModel.findById(id);

  if (!template) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Submission template not found');
  }

  template.set(input);
  await template.save();
  await audit(context, ADMIN_ACTIONS.submissionTemplateUpdate, template._id.toString(), {
    changedFields: Object.keys(input)
  });

  return template;
};

export const listReportDeliveries = async (
  context: AdminServiceContext,
  query: ReportDeliveryQueryInput
): Promise<unknown[]> => {
  const submissions = await ReportSubmissionModel.find({
    deletedAt: { $exists: false },
    ...(query.status ? { status: query.status } : {}),
    ...(query.destinationType ? { destinationType: query.destinationType } : {}),
    ...(query.channel ? { channel: query.channel } : {})
  })
    .select({
      payloadSnapshot: 0,
      evidenceSnapshot: 0,
      consentSnapshot: 0,
      acknowledgementPayload: 0
    })
    .sort({ updatedAt: -1 })
    .limit(query.limit)
    .lean();

  await audit(context, ADMIN_ACTIONS.reportDeliveriesList, undefined, {
    count: submissions.length,
    status: query.status,
    destinationType: query.destinationType,
    channel: query.channel
  });

  return submissions.map((submission) => ({
    ...submission,
    _id: submission._id.toString(),
    reportId: submission.reportId.toString(),
    destinationId: submission.destinationId.toString(),
    templateId: submission.templateId?.toString(),
    hasExternalReference: Boolean(submission.externalReference),
    hasDeliveryArtifacts: Array.isArray(submission.deliveryArtifacts)
      ? submission.deliveryArtifacts.length > 0
      : false
  }));
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

export const getEducationalContentOverview = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const [
    microCards,
    publishedMicroCards,
    draftMicroCards,
    contentResources,
    publishedContentResources,
    mediaAssets,
    publishedMediaAssets,
    resourceDirectoryItems,
    educationKnowledgeSources,
    pendingLegalSources,
    contentLanguages,
    microCardTags,
    resourceCategories,
    contentResourceCategories,
    mediaAssetCategories
  ] = await Promise.all([
    MicroEducationModel.countDocuments({ deletedAt: { $exists: false } }),
    MicroEducationModel.countDocuments({ status: 'published', deletedAt: { $exists: false } }),
    MicroEducationModel.countDocuments({ status: 'draft', deletedAt: { $exists: false } }),
    ContentResourceModel.countDocuments({ deletedAt: { $exists: false } }),
    ContentResourceModel.countDocuments({ status: 'published', deletedAt: { $exists: false } }),
    MediaAssetModel.countDocuments({ deletedAt: { $exists: false } }),
    MediaAssetModel.countDocuments({ status: 'published', deletedAt: { $exists: false } }),
    ResourceModel.countDocuments({ deletedAt: { $exists: false } }),
    RagKnowledgeSourceModel.countDocuments({
      topic: 'education',
      deletedAt: { $exists: false }
    }),
    RagKnowledgeSourceModel.countDocuments({
      status: 'pending_review',
      sourceCategory: { $in: ['official_legal_source', 'official_support_source'] },
      deletedAt: { $exists: false }
    }),
    ContentResourceModel.distinct('language', { deletedAt: { $exists: false } }),
    MicroEducationModel.distinct('tag', { deletedAt: { $exists: false } }),
    ResourceModel.distinct('category', { deletedAt: { $exists: false } }),
    ContentResourceModel.distinct('category', { deletedAt: { $exists: false } }),
    MediaAssetModel.distinct('category', { deletedAt: { $exists: false } })
  ]);

  const categoryCount = new Set([
    ...microCardTags,
    ...resourceCategories,
    ...contentResourceCategories,
    ...mediaAssetCategories
  ]).size;
  const formatCount = Number(contentResources > 0) + Number(mediaAssets > 0) + Number(microCards > 0);
  const languageCount = contentLanguages.length;

  await audit(context, ADMIN_ACTIONS.educationalContentOverview, undefined, {
    microCards,
    contentResources,
    mediaAssets,
    resourceDirectoryItems,
    categoryCount,
    languageCount
  });

  return {
    eyebrow: 'Content & Education Management',
    title: 'Educational Content',
    description:
      'Manage the broader education program that surrounds resources, language adaptation, legal review, and youth-friendly guidance.',
    statusNote: 'Education operations are API-backed and synced with content records',
    stats: [
      {
        label: 'CONTENT TRACKS',
        value: '5',
        helper: `${categoryCount || 0} active content categories are represented across cards, resources, and media.`
      },
      {
        label: 'LEGAL SIGN-OFF',
        value: pendingLegalSources > 0 ? `${pendingLegalSources} pending` : 'Required',
        helper: 'Legal and official source material remains routed through review before publication.'
      },
      {
        label: 'YOUTH VARIANTS',
        value: draftMicroCards > 0 ? `${draftMicroCards} drafts` : 'Planned',
        helper: 'Draft micro-cards can be adapted into simpler, youth-friendly variants.'
      },
      {
        label: 'COMMUNITY LANGUAGES',
        value: languageCount > 0 ? String(languageCount) : 'Localized',
        helper: 'Published resources can be tracked by language for community adaptation.'
      }
    ],
    modules: [
      {
        id: 'category-management',
        label: 'Category Management',
        status: 'Active',
        summary:
          'Organize educational material by topic like DFV, online safety, racism, scams, and related harm patterns.',
        owner: 'Content Operations',
        cadence: 'Weekly content review',
        metric: `${categoryCount || 0} categories currently tracked`,
        highlights: [
          "Keep educational content aligned with the platform's incident taxonomy.",
          'Support discovery and reporting on which topics need more coverage.',
          'Avoid duplicated content by centralizing category ownership.'
        ]
      },
      {
        id: 'multi-format-content',
        label: 'Multi-format Content',
        status: formatCount >= 2 ? 'Active' : 'Ready',
        summary: 'Manage text, audio, PDF, and shareable assets from one educational-content workflow.',
        owner: 'Content Production',
        cadence: 'Per publication cycle',
        metric: `${contentResources + mediaAssets + microCards} total educational items`,
        highlights: [
          `${microCards} micro-cards, ${contentResources} downloadable resources, and ${mediaAssets} media assets are tracked.`,
          `${publishedMicroCards + publishedContentResources + publishedMediaAssets} items are currently published.`,
          'Keep format choice tied to accessibility and audience needs.'
        ]
      },
      {
        id: 'youth-friendly-variants',
        label: 'Youth-Friendly Variants',
        status: draftMicroCards > 0 ? 'Priority' : 'Ready',
        summary: 'Prepare simpler-language, icon-supported, and accessible variants for younger audiences.',
        owner: 'Youth Safety Content',
        cadence: 'Per relevant asset',
        metric: `${draftMicroCards} draft micro-cards available for adaptation`,
        highlights: [
          'Separate youth-safe variants from general audience content where tone and examples differ.',
          'Coordinate with legal and moderation teams on age-sensitive material.',
          'Keep accessibility and readability part of the publishing checklist.'
        ]
      },
      {
        id: 'legal-content-review',
        label: 'Legal Content Review',
        status: pendingLegalSources > 0 ? 'Priority' : 'Active',
        summary: 'Require legal approval on guidance that could be interpreted as advice or rights information.',
        owner: 'Legal Content Review',
        cadence: 'Before publication',
        metric: `${pendingLegalSources} official sources pending review`,
        highlights: [
          'Flag content that crosses into rights, reporting, or evidentiary guidance.',
          `${educationKnowledgeSources} education-topic knowledge sources are connected to the review workflow.`,
          'Connect review outcomes to disclaimer management.'
        ]
      },
      {
        id: 'community-languages',
        label: 'Community Languages',
        status: languageCount > 0 ? 'Monitored' : 'Ready',
        summary: 'Ensure educational assets are translated and culturally adapted for the communities SafeSpeak serves.',
        owner: 'Localization and Community Teams',
        cadence: 'Per release',
        metric: `${languageCount} resource languages currently represented`,
        highlights: [
          'Coordinate localization with language-pack and cultural-profile governance.',
          'Track which assets still need community review after translation.',
          `${resourceDirectoryItems} support/resource directory entries can be paired with localized educational assets.`
        ]
      }
    ],
    quickLinks: [
      {
        label: 'Knowledge Sources',
        to: '/admin/content-management/knowledge-sources',
        description: 'Update the source material and template phrasing feeding educational assets.'
      },
      {
        label: 'Micro-Education Cards',
        to: '/admin/content-management/micro-education-cards',
        description: 'Create and publish reusable educational snippets for rapid in-product guidance.'
      },
      {
        label: 'Language Packs',
        to: '/admin/platform-intelligence/language-packs',
        description: 'Coordinate translation, RTL, and community testing for the education program.'
      },
      {
        label: 'Resource Library',
        to: '/admin/content-management/resource-library',
        description: 'Connect educational strategy to downloadable assets and production resources.'
      }
    ],
    watchlistTitle: 'Content Program Focus',
    watchlist: [
      'Educational content should stay synchronized with taxonomy, legal review, and community-language priorities.',
      'Youth-safe adaptations need their own quality bar rather than being treated as a simple rewrite.',
      'Micro-cards and full resources should feel like parts of the same education system, not separate silos.'
    ]
  };
};

const percent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 100) : 0;

const uniqueStringValues = (...groups: Array<unknown[]>): string[] =>
  Array.from(
    new Set(
      groups
        .flat()
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    )
  ).sort((left, right) => left.localeCompare(right));

const RTL_LANGUAGE_CODES = new Set(['ar', 'fa', 'he', 'ur']);

export const getLanguagePacksOverview = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const now = new Date();
  const next30Days = new Date(now);
  next30Days.setUTCDate(next30Days.getUTCDate() + 30);
  const last30Days = new Date(now);
  last30Days.setUTCDate(last30Days.getUTCDate() - 30);

  const taxonomyCatalog = await getTaxonomyCatalog();
  const configuredLanguageCodes = taxonomyCatalog.languages.map((language) => language.key);
  const configuredLanguageLabels = taxonomyCatalog.languages.map((language) => language.label);
  const rtlLanguages = taxonomyCatalog.languages.filter((language) =>
    RTL_LANGUAGE_CODES.has(language.key.toLowerCase())
  );

  const [
    activeLanguageTaxonomies,
    inactiveLanguageTaxonomies,
    contentLanguages,
    publishedContentResources,
    pendingContentResources,
    resourcesDueForReview,
    knowledgeSourceLanguages,
    approvedKnowledgeSources,
    pendingKnowledgeSources,
    legalReviewedSources,
    aiLanguages,
    translationRequests,
    transcriptionRequests,
    evidenceTranscriptionLanguages,
    destinationLanguages,
    culturalProfileLanguages,
    publishedMicroCards,
    draftMicroCards
  ] = await Promise.all([
    AdminTaxonomyModel.countDocuments({
      type: 'language',
      isActive: true,
      deletedAt: { $exists: false }
    }),
    AdminTaxonomyModel.countDocuments({
      type: 'language',
      isActive: false,
      deletedAt: { $exists: false }
    }),
    ContentResourceModel.distinct('language', { deletedAt: { $exists: false } }),
    ContentResourceModel.countDocuments({
      deletedAt: { $exists: false },
      status: 'published'
    }),
    ContentResourceModel.countDocuments({
      deletedAt: { $exists: false },
      status: { $ne: 'published' }
    }),
    ContentResourceModel.countDocuments({
      deletedAt: { $exists: false },
      reviewDate: { $lte: next30Days }
    }),
    RagKnowledgeSourceModel.distinct('language', { deletedAt: { $exists: false } }),
    RagKnowledgeSourceModel.countDocuments({
      status: 'approved',
      deletedAt: { $exists: false }
    }),
    RagKnowledgeSourceModel.countDocuments({
      status: 'pending_review',
      deletedAt: { $exists: false }
    }),
    RagKnowledgeSourceModel.countDocuments({
      legalReviewed: true,
      deletedAt: { $exists: false }
    }),
    AiInteractionModel.distinct('language'),
    AiInteractionModel.countDocuments({
      action: AI_ACTIONS.translate,
      createdAt: { $gte: last30Days }
    }),
    AiInteractionModel.countDocuments({
      action: AI_ACTIONS.audioTranscriptionRequested,
      createdAt: { $gte: last30Days }
    }),
    EvidenceModel.distinct('transcription.language', {
      'transcription.language': { $exists: true, $ne: '' },
      deletedAt: { $exists: false }
    }),
    AdminDestinationModel.distinct('languages', {
      isActive: true
    }),
    AdminCulturalProfileModel.distinct('languages', {
      isActive: true,
      deletedAt: { $exists: false }
    }),
    MicroEducationModel.countDocuments({
      status: 'published',
      deletedAt: { $exists: false }
    }),
    MicroEducationModel.countDocuments({
      status: 'draft',
      deletedAt: { $exists: false }
    })
  ]);

  const observedLanguages = uniqueStringValues(
    configuredLanguageCodes,
    configuredLanguageLabels,
    contentLanguages,
    knowledgeSourceLanguages,
    aiLanguages,
    evidenceTranscriptionLanguages,
    destinationLanguages,
    culturalProfileLanguages
  );
  const configuredLanguageCount = configuredLanguageCodes.length;
  const liveLanguageCoverage = uniqueStringValues(
    contentLanguages,
    knowledgeSourceLanguages,
    aiLanguages,
    evidenceTranscriptionLanguages,
    destinationLanguages,
    culturalProfileLanguages
  ).length;
  const validationQueue = pendingContentResources + pendingKnowledgeSources + resourcesDueForReview;
  const humanValidationCoverage = percent(legalReviewedSources, approvedKnowledgeSources);
  const audioSignals = transcriptionRequests + evidenceTranscriptionLanguages.length;
  const rtlReady = rtlLanguages.length > 0;

  await audit(context, ADMIN_ACTIONS.languagePacksOverview, undefined, {
    configuredLanguageCount,
    activeLanguageTaxonomies,
    liveLanguageCoverage,
    validationQueue,
    translationRequests,
    transcriptionRequests,
    rtlLanguages: rtlLanguages.map((language) => language.key)
  });

  return {
    eyebrow: 'Platform Intelligence Engine',
    title: 'Language Packs',
    description:
      'Manage multilingual content operations, validation, speech quality, and right-to-left support for SafeSpeak users.',
    statusNote: 'Multilingual operations are backed by live language taxonomy, content, RAG, AI, and referral telemetry',
    stats: [
      {
        label: 'SUPPORTED LANGUAGES',
        value: configuredLanguageCount > 0 ? String(configuredLanguageCount) : '0',
        helper:
          configuredLanguageCount > 0
            ? `${configuredLanguageCount} configured languages; ${activeLanguageTaxonomies} active and ${inactiveLanguageTaxonomies} inactive admin language overrides.`
            : 'Create language taxonomy records before multilingual workflows can be tracked.'
      },
      {
        label: 'RTL SUPPORT',
        value: rtlReady ? 'Ready' : 'Plan',
        helper:
          rtlReady
            ? `${rtlLanguages.map((language) => language.label).join(', ')} require RTL QA coverage.`
            : 'No RTL language code is currently configured in language taxonomies.'
      },
      {
        label: 'HUMAN VALIDATION',
        value: validationQueue > 0 ? String(validationQueue) : 'Current',
        helper:
          validationQueue > 0
            ? `${validationQueue} content/source review items need attention.`
            : `${humanValidationCoverage}% of approved knowledge sources are marked legally reviewed.`
      },
      {
        label: 'AUDIO QUALITY',
        value: audioSignals > 0 ? String(audioSignals) : 'Tracked',
        helper:
          audioSignals > 0
            ? `${transcriptionRequests} ASR requests in the last 30 days and ${evidenceTranscriptionLanguages.length} transcription languages observed.`
            : 'ASR and TTS quality stay visible even before audio activity is recorded.'
      }
    ],
    modules: [
      {
        id: 'translation-management',
        label: 'Translation Management',
        status: validationQueue > 0 ? 'Priority' : 'Ready',
        summary: 'Coordinate machine translation, human review, and publication status for multilingual content.',
        owner: 'Localization Team',
        cadence: 'Per content release',
        metric: `${translationRequests} translation requests in the last 30 days`,
        highlights: [
          `${pendingContentResources} content resources are not published and ${pendingKnowledgeSources} knowledge sources are pending review.`,
          `${resourcesDueForReview} content resources have review dates due within 30 days.`,
          `${approvedKnowledgeSources} approved knowledge sources can support multilingual RAG and content workflows.`
        ]
      },
      {
        id: 'content-localization',
        label: 'Content Localization',
        status: publishedContentResources > 0 ? 'Active' : 'Ready',
        summary: 'Adapt legal, micro-education, and support content so it remains contextually appropriate after translation.',
        owner: 'Content Operations',
        cadence: 'Per language pack update',
        metric: `${publishedContentResources} published resources across ${contentLanguages.length} content languages`,
        highlights: [
          `${contentLanguages.length ? contentLanguages.join(', ') : 'No'} content-resource languages are currently stored.`,
          `${publishedMicroCards} micro-education cards are published and ${draftMicroCards} are draft.`,
          'Localized assets remain connected to content-resource, knowledge-source, and cultural-profile governance.'
        ]
      },
      {
        id: 'asr-tts-quality',
        label: 'ASR/TTS Quality',
        status: audioSignals > 0 ? 'Monitored' : 'Ready',
        summary: 'Watch speech recognition and speech synthesis quality for accessible, multilingual experiences.',
        owner: 'Accessibility Engineering',
        cadence: 'Monthly QA',
        metric: `${audioSignals} live audio-language signals`,
        highlights: [
          `${transcriptionRequests} transcription requests were recorded in the last 30 days.`,
          evidenceTranscriptionLanguages.length > 0
            ? `Evidence transcription languages observed: ${evidenceTranscriptionLanguages.join(', ')}.`
            : 'No evidence transcription language spread is recorded yet.',
          'Audio quality should be reviewed alongside translation and accessibility release readiness.'
        ]
      },
      {
        id: 'right-to-left-ui',
        label: 'Right-to-Left UI',
        status: rtlReady ? 'Ready' : 'Priority',
        summary: 'Plan layout, spacing, and component behavior for RTL languages like Arabic.',
        owner: 'Frontend Platform',
        cadence: 'Before RTL releases',
        metric: rtlReady
          ? `${rtlLanguages.length} RTL language${rtlLanguages.length === 1 ? '' : 's'} configured`
          : 'No RTL language configured',
        highlights: [
          rtlReady
            ? `RTL language codes configured: ${rtlLanguages.map((language) => language.key).join(', ')}.`
            : 'Add Arabic, Urdu, Hebrew, or another RTL language taxonomy when RTL support is in scope.',
          'Navigation, tables, form controls, and dashboard cards should be checked in RTL viewports.',
          'RTL QA should stay tied to release readiness, not only translation completion.'
        ]
      },
      {
        id: 'community-testing',
        label: 'Community Testing',
        status: culturalProfileLanguages.length > 0 ? 'Active' : 'Ready',
        summary: 'Capture real feedback from CALD communities before multilingual content is considered ready.',
        owner: 'Community Validation',
        cadence: 'Per release',
        metric: `${culturalProfileLanguages.length} cultural-profile language codes linked`,
        highlights: [
          culturalProfileLanguages.length > 0
            ? `Managed cultural profiles reference: ${culturalProfileLanguages.join(', ')}.`
            : 'No managed cultural-profile language codes are linked yet.',
          `${destinationLanguages.length} active destination language codes can influence referral availability.`,
          `Observed language footprint: ${observedLanguages.length ? observedLanguages.join(', ') : 'none yet'}.`
        ]
      }
    ],
    quickLinks: [
      {
        label: 'AI Engine Control',
        to: '/admin/platform-intelligence/ai-engine-control',
        description: 'Review translation and language-quality metrics alongside model guardrails.'
      },
      {
        label: 'Cultural Profiles',
        to: '/admin/platform-intelligence/cultural-profiles',
        description: 'Align language options with cultural and community response templates.'
      },
      {
        label: 'Upload Resource',
        to: '/admin/content-management/upload-resource',
        description: 'Publish multilingual assets and track review dates for localized resources.'
      },
      {
        label: 'Knowledge Sources',
        to: '/admin/content-management/knowledge-sources',
        description: 'Manage multilingual phrasing and disclaimer templates at the source level.'
      }
    ],
    watchlistTitle: 'Language Operations',
    watchlist: [
      validationQueue > 0
        ? 'Some multilingual content or knowledge-source records still need review before release.'
        : 'No content/source review backlog is currently visible from language-pack telemetry.',
      rtlReady
        ? 'RTL-capable language taxonomies exist; keep layout QA tied to each release.'
        : 'RTL support is not yet represented in language taxonomy data.',
      audioSignals > 0
        ? 'Audio-language activity exists; ASR/TTS quality should be reviewed for accessibility and dialect fit.'
        : 'No live audio-language activity is recorded yet; keep ASR/TTS validation ready for future uploads.'
    ],
    footerNote:
      'Live values are aggregated from language taxonomies, content resources, knowledge sources, AI translation/transcription interactions, evidence transcripts, destinations, and cultural profiles.'
  };
};

export const getDataProtectionOverview = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const now = new Date();
  const last30Days = new Date(now);
  last30Days.setUTCDate(last30Days.getUTCDate() - 30);

  const evidenceBaseFilter = { deletedAt: { $exists: false } };
  const completedEvidenceFilter = {
    ...evidenceBaseFilter,
    status: { $nin: ['pending_upload', 'draft'] }
  };
  const sensitiveAccessFilter = {
    createdAt: { $gte: last30Days },
    resourceType: { $in: ['evidence', 'report', 'profile', 'consent', 'user'] }
  };
  const completedEvidenceIds = await EvidenceModel.distinct('_id', completedEvidenceFilter);

  const [
    totalEvidence,
    hashedEvidence,
    encryptedEvidence,
    localEncryptedEvidence,
    s3Evidence,
    evidenceAuditEvents,
    evidenceWithAuditTrail,
    openPrivacyRequests,
    totalReports,
    recordsPendingDeletion,
    deletedRecords,
    sensitiveAccessEvents,
    adminChangeEvents,
    storageProviders
  ] = await Promise.all([
    EvidenceModel.countDocuments(evidenceBaseFilter),
    EvidenceModel.countDocuments({
      ...completedEvidenceFilter,
      sha256Hash: { $exists: true, $ne: '' }
    }),
    EvidenceModel.countDocuments({
      ...completedEvidenceFilter,
      'encryption.algorithm': 'aes-256-gcm'
    }),
    EvidenceModel.countDocuments({
      ...completedEvidenceFilter,
      storageProvider: 'local_encrypted'
    }),
    EvidenceModel.countDocuments({
      ...completedEvidenceFilter,
      storageProvider: 's3'
    }),
    EvidenceAuditChainModel.countDocuments(),
    EvidenceAuditChainModel.distinct('evidenceId', {
      evidenceId: { $in: completedEvidenceIds }
    }),
    PrivacyRequestModel.countDocuments({ status: { $in: ['pending', 'in_review'] } }),
    ReportModel.countDocuments({ deletedAt: { $exists: false } }),
    Promise.all([
      EvidenceModel.countDocuments({ deletionRequestedAt: { $exists: true }, deletedAt: { $exists: false } }),
      ReportModel.countDocuments({ deletionRequestedAt: { $exists: true }, deletedAt: { $exists: false } })
    ]).then(([evidenceCount, reportCount]) => evidenceCount + reportCount),
    Promise.all([
      EvidenceModel.countDocuments({ deletedAt: { $exists: true } }),
      ReportModel.countDocuments({ deletedAt: { $exists: true } })
    ]).then(([evidenceCount, reportCount]) => evidenceCount + reportCount),
    AuditLogModel.countDocuments(sensitiveAccessFilter),
    AuditLogModel.countDocuments({
      createdAt: { $gte: last30Days },
      actorType: 'admin'
    }),
    EvidenceModel.distinct('storageProvider', completedEvidenceFilter)
  ]);

  const completedEvidence = completedEvidenceIds.length;
  const hashCoverage = percent(hashedEvidence, completedEvidence);
  const encryptionCoverage = percent(encryptedEvidence, completedEvidence);
  const auditTrailCoverage = percent(evidenceWithAuditTrail.length, completedEvidence);
  const storageMode = hasS3Storage() ? 'S3 + local encrypted' : 'Local encrypted';
  const encryptionConfigured = Boolean(env.EVIDENCE_ENCRYPTION_KEY || env.JWT_ACCESS_SECRET);
  const auditSigningConfigured = Boolean(env.EVIDENCE_AUDIT_SIGNING_KEY || env.JWT_REFRESH_SECRET);
  const dataTiers = [
    'public',
    'sensitive',
    'pii'
  ];
  const retentionQueue = recordsPendingDeletion + deletedRecords;

  await audit(context, ADMIN_ACTIONS.dataProtectionOverview, undefined, {
    totalEvidence,
    completedEvidence,
    hashedEvidence,
    encryptedEvidence,
    evidenceAuditEvents,
    openPrivacyRequests,
    sensitiveAccessEvents
  });

  return {
    eyebrow: 'Security & Compliance Center',
    title: 'Data Protection',
    description:
      'Protect victim, witness, and partner data with encryption, chain-of-custody controls, retention rules, and resilient recovery workflows.',
    statusNote: 'Sensitive-data controls are backed by live evidence, audit, privacy, and storage telemetry',
    stats: [
      {
        label: 'EVIDENCE CHAIN',
        value: completedEvidence > 0 ? `${hashCoverage}%` : 'SHA-256',
        helper:
          completedEvidence > 0
            ? `${hashedEvidence}/${completedEvidence} completed evidence records have SHA-256 hashes; ${evidenceAuditEvents} chain events are stored.`
            : 'SHA-256 hashing is enforced when evidence uploads are completed.'
      },
      {
        label: 'RETENTION BASELINE',
        value: '90 days',
        helper:
          retentionQueue > 0
            ? `${recordsPendingDeletion} records are pending deletion and ${deletedRecords} are already deleted.`
            : 'No deleted or pending-deletion report/evidence records are currently in the retention queue.'
      },
      {
        label: 'BACKUP EXPECTATION',
        value: hasS3Storage() ? 'S3 ready' : 'Local only',
        helper: `${storageMode} storage is active for evidence; encrypted backups remain an operational control.`
      },
      {
        label: 'DATA TIERS',
        value: String(dataTiers.length),
        helper: `${dataTiers.join(', ')} classifications drive handling expectations across ${totalReports} reports and ${totalEvidence} evidence records.`
      }
    ],
    modules: [
      {
        id: 'encryption-management',
        label: 'Encryption Management',
        status: encryptionCoverage === 100 || completedEvidence === 0 ? 'Active' : 'Priority',
        summary: 'Track KMS use, key rotation, and encryption posture across stored case data and attachments.',
        owner: 'Infrastructure Security',
        cadence: 'Monthly key review',
        metric:
          completedEvidence > 0
            ? `${encryptedEvidence}/${completedEvidence} completed evidence records encrypted`
            : 'AES-256-GCM configured for new evidence',
        highlights: [
          `Evidence encryption uses AES-256-GCM with ${encryptionConfigured ? 'configured key material' : 'fallback key material'}.`,
          `${localEncryptedEvidence} completed evidence records use local encrypted storage; ${s3Evidence} are synced to S3.`,
          `Evidence audit signing is ${auditSigningConfigured ? 'configured' : 'falling back to JWT refresh secret material'}.`
        ]
      },
      {
        id: 'evidence-chain',
        label: 'Evidence Chain',
        status: completedEvidence === 0 || (hashCoverage === 100 && auditTrailCoverage === 100) ? 'Active' : 'Priority',
        summary: 'Preserve uploads, hashes, timestamps, and access history so evidence remains trustworthy.',
        owner: 'Investigations Operations',
        cadence: 'Per upload and access event',
        metric:
          completedEvidence > 0
            ? `${hashCoverage}% hash coverage and ${auditTrailCoverage}% audit-chain coverage`
            : 'Ready for first completed evidence upload',
        highlights: [
          `${hashedEvidence}/${completedEvidence} completed evidence records include a SHA-256 hash.`,
          `${evidenceWithAuditTrail.length}/${completedEvidence} completed evidence records have at least one chain-of-custody event.`,
          `${evidenceAuditEvents} immutable evidence audit-chain events are stored.`
        ]
      },
      {
        id: 'data-classification',
        label: 'Data Classification',
        status: 'Ready',
        summary: 'Define which records are public, sensitive, or PII-heavy so downstream handling stays consistent.',
        owner: 'Privacy Engineering',
        cadence: 'Policy-driven',
        metric: `${dataTiers.length} data tiers applied to report, evidence, profile, privacy, and analytics handling`,
        highlights: [
          `${totalReports} active reports and ${totalEvidence} active evidence records are treated as sensitive operational data.`,
          `${openPrivacyRequests} open privacy requests can affect access, export, deletion, or anonymization handling.`,
          'Analytics and admin exports should inherit public, sensitive, or PII labels before leaving the platform.'
        ]
      },
      {
        id: 'access-logging',
        label: 'Access Logging',
        status: sensitiveAccessEvents > 0 || adminChangeEvents > 0 ? 'Monitored' : 'Ready',
        summary: 'Track who opened sensitive data, what was viewed, and whether consent or justification was recorded.',
        owner: 'Compliance Operations',
        cadence: 'Continuous',
        metric: `${sensitiveAccessEvents} sensitive-resource audit events in the last 30 days`,
        highlights: [
          `${adminChangeEvents} admin audit events were recorded in the last 30 days.`,
          'Evidence, report, profile, consent, and user records are included in sensitive access monitoring.',
          'Audit logs store actor, resource, action, hashed request metadata, and timestamp without exposing raw secrets.'
        ]
      },
      {
        id: 'retention-policies',
        label: 'Retention Policies',
        status: recordsPendingDeletion > 0 ? 'Priority' : 'Ready',
        summary: 'Set lifecycle rules and legal-hold exceptions without burying them in separate documents.',
        owner: 'Legal and Privacy',
        cadence: 'Quarterly or policy-triggered',
        metric: `${recordsPendingDeletion} records pending deletion across reports and evidence`,
        highlights: [
          'The dashboard uses a 90-day operational baseline for retention review.',
          `${deletedRecords} report/evidence records are already marked deleted.`,
          `${openPrivacyRequests} open privacy requests may require retention, export, deletion, or review action.`
        ]
      },
      {
        id: 'backup-recovery',
        label: 'Backup & Recovery',
        status: hasS3Storage() ? 'Monitored' : 'Ready',
        summary: 'Keep encrypted backups, restore testing, and resilience objectives visible to administrators.',
        owner: 'Platform Reliability',
        cadence: 'Quarterly restore tests',
        metric: `${storageProviders.length || 0} evidence storage provider${storageProviders.length === 1 ? '' : 's'} observed`,
        highlights: [
          `Configured evidence storage mode: ${storageMode}.`,
          `Observed completed evidence providers: ${storageProviders.length ? storageProviders.join(', ') : 'none yet'}.`,
          'Restore tests and encrypted backup verification should be recorded through operational review.'
        ]
      }
    ],
    quickLinks: [
      {
        label: 'Privacy Controls',
        to: '/admin/security-compliance/privacy-controls',
        description: 'Coordinate access logging with consent, deletion, and PII handling requirements.'
      },
      {
        label: 'Audit Logs',
        to: '/admin/audit-logs',
        description: 'Verify chain-of-custody actions are discoverable during reviews and investigations.'
      },
      {
        label: 'Platform Health',
        to: '/admin/insights/platform-health',
        description: 'Cross-check backup and restore health with uptime, incident, and recovery goals.'
      },
      {
        label: 'Legal Compliance',
        to: '/admin/security-compliance/legal-compliance',
        description: 'Align retention decisions with subpoena, youth-safety, and regulatory obligations.'
      }
    ],
    watchlistTitle: 'Data Protection Notes',
    watchlist: [
      completedEvidence > hashedEvidence
        ? 'Some completed evidence records are missing SHA-256 hashes and should be reviewed.'
        : 'Evidence hash coverage is current for completed evidence records.',
      recordsPendingDeletion > 0
        ? 'Pending deletion records need privacy/legal review before the next retention cycle closes.'
        : 'No report or evidence records are currently waiting for deletion action.',
      hasS3Storage()
        ? 'S3 evidence sync is configured; keep restore testing and bucket policy review on the quarterly checklist.'
        : 'Evidence is currently local-encrypted only; confirm backup and recovery expectations outside S3.'
    ],
    footerNote:
      'Live values are aggregated from evidence records, evidence audit chains, audit logs, privacy requests, reports, and storage configuration. Secrets and raw evidence payloads are never returned by this endpoint.'
  };
};

const formatDecimal = (value: number): string => value.toFixed(2);

export const getAiEngineOverview = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const now = new Date();
  const last30Days = new Date(now);
  last30Days.setUTCDate(last30Days.getUTCDate() - 30);

  const [
    totalInteractions,
    recentInteractions,
    pendingHumanReview,
    approvedReviews,
    rejectedReviews,
    citedInteractions,
    timelineAssistantTurns,
    ragAnswers,
    translationRequests,
    redactionRequests,
    languages,
    models,
    conversationSessions,
    recentConversationSessions,
    triageCount,
    triageConfidenceAggregate,
    lowConfidenceTriage,
    humanReviewTriage,
    triageCategories,
    approvedKnowledgeSources,
    pendingKnowledgeSources,
    legalReviewedSources,
    ragChunks,
    adminContentSources
  ] = await Promise.all([
    AiInteractionModel.countDocuments(),
    AiInteractionModel.countDocuments({ createdAt: { $gte: last30Days } }),
    AiInteractionModel.countDocuments({ reviewStatus: 'pending_human_review' }),
    AiInteractionModel.countDocuments({ reviewStatus: 'approved' }),
    AiInteractionModel.countDocuments({ reviewStatus: 'rejected' }),
    AiInteractionModel.countDocuments({ 'citations.0': { $exists: true } }),
    AiInteractionModel.countDocuments({ action: AI_ACTIONS.timelineAssistant }),
    AiInteractionModel.countDocuments({ action: AI_ACTIONS.ragAnswer }),
    AiInteractionModel.countDocuments({ action: AI_ACTIONS.translate }),
    AiInteractionModel.countDocuments({ action: AI_ACTIONS.redactPii }),
    AiInteractionModel.distinct('language'),
    AiInteractionModel.distinct('model'),
    ConversationFlowSessionModel.countDocuments(),
    ConversationFlowSessionModel.countDocuments({ createdAt: { $gte: last30Days } }),
    ConversationFlowTriageModel.countDocuments(),
    ConversationFlowTriageModel.aggregate<{ _id: null; averageConfidence: number }>([
      {
        $group: {
          _id: null,
          averageConfidence: { $avg: '$confidenceScore' }
        }
      }
    ]),
    ConversationFlowTriageModel.countDocuments({ confidenceScore: { $lt: 0.8 } }),
    ConversationFlowTriageModel.countDocuments({ humanReviewRecommended: true }),
    ConversationFlowTriageModel.distinct('likelyCategory'),
    RagKnowledgeSourceModel.countDocuments({ status: 'approved', deletedAt: { $exists: false } }),
    RagKnowledgeSourceModel.countDocuments({
      status: 'pending_review',
      deletedAt: { $exists: false }
    }),
    RagKnowledgeSourceModel.countDocuments({
      legalReviewed: true,
      deletedAt: { $exists: false }
    }),
    RagChunkModel.countDocuments(),
    RagKnowledgeSourceModel.countDocuments({
      sourceCategory: 'admin_content',
      deletedAt: { $exists: false }
    })
  ]);

  const averageConfidence = triageConfidenceAggregate[0]?.averageConfidence ?? 0;
  const triageTargetMet = triageCount > 0 && averageConfidence >= 0.8;
  const humanReviewRate = percent(pendingHumanReview, totalInteractions);
  const languageCount = languages.length;
  const openAiConfigured = Boolean(env.OPENAI_API_KEY);
  const ragReady = approvedKnowledgeSources > 0 && ragChunks > 0;
  const deploymentSafetyStatus = openAiConfigured && ragReady ? 'Monitored' : 'Priority';
  const activeModels = models.length ? models.join(', ') : env.OPENAI_MODEL;

  await audit(context, ADMIN_ACTIONS.aiEngineOverview, undefined, {
    totalInteractions,
    recentInteractions,
    pendingHumanReview,
    triageCount,
    averageConfidence,
    approvedKnowledgeSources,
    ragChunks,
    openAiConfigured
  });

  return {
    eyebrow: 'Platform Intelligence Engine',
    title: 'AI Engine Control',
    description:
      'Monitor model quality, translation accuracy, safety guardrails, bias checks, and deployment readiness for the SafeSpeak AI layer.',
    statusNote: 'AI operations are backed by live model, RAG, triage, and review telemetry',
    stats: [
      {
        label: 'TRIAGE TARGET',
        value: triageCount > 0 ? formatDecimal(averageConfidence) : '>= 0.80',
        helper:
          triageCount > 0
            ? `${triageCount} triage records tracked; ${lowConfidenceTriage} are below the 0.80 confidence target.`
            : 'Extraction and triage accuracy goals remain visible until live triage records exist.'
      },
      {
        label: 'LANGUAGE QUALITY',
        value: languageCount > 0 ? `${languageCount} langs` : '>= 90%',
        helper:
          languageCount > 0
            ? `${languages.join(', ')} represented in AI interaction records.`
            : 'Language validation acceptability is treated as an operational KPI.'
      },
      {
        label: 'HUMAN REVIEW',
        value: pendingHumanReview > 0 ? String(pendingHumanReview) : 'Edge cases',
        helper:
          totalInteractions > 0
            ? `${humanReviewRate}% of AI interactions are currently pending human review.`
            : 'Flagged content and uncertain outputs stay routed to people.'
      },
      {
        label: 'DEPLOYMENT SAFETY',
        value: openAiConfigured ? 'Configured' : 'Needs key',
        helper: `Active model: ${env.OPENAI_MODEL}; RAG index: ${env.RAG_VECTOR_INDEX}.`
      }
    ],
    modules: [
      {
        id: 'model-performance',
        label: 'Model Performance',
        status: triageCount === 0 || triageTargetMet ? 'Active' : 'Priority',
        summary: 'Track extraction quality, triage accuracy, and failure modes that impact user safety.',
        owner: 'AI Operations',
        cadence: 'Weekly review',
        metric:
          triageCount > 0
            ? `Average triage confidence ${formatDecimal(averageConfidence)}`
            : 'Triage target is ready for live records',
        highlights: [
          `${conversationSessions} onboarding conversation sessions are tracked; ${recentConversationSessions} were created in the last 30 days.`,
          `${triageCount} triage records exist with ${lowConfidenceTriage} below confidence target.`,
          `${timelineAssistantTurns} timeline-assistant model turns have been recorded.`
        ]
      },
      {
        id: 'training-data',
        label: 'Training Data',
        status: approvedKnowledgeSources > 0 ? 'Active' : 'Ready',
        summary: 'Track curated, community-validated datasets used for model improvement and safety checks.',
        owner: 'ML Enablement',
        cadence: 'Per release cycle',
        metric: `${approvedKnowledgeSources} approved knowledge sources and ${ragChunks} RAG chunks`,
        highlights: [
          `${legalReviewedSources} knowledge sources are marked legally reviewed.`,
          `${pendingKnowledgeSources} sources are pending human review before use.`,
          `${adminContentSources} admin-content sources are available for curated operational guidance; ${ragAnswers} RAG answers have been recorded.`
        ]
      },
      {
        id: 'guardrails-monitor',
        label: 'Guardrails Monitor',
        status: pendingHumanReview > 0 ? 'Active' : 'Ready',
        summary: 'Watch for legal-advice drift, unsafe suggestions, and prompt-level risk patterns.',
        owner: 'AI Safety',
        cadence: 'Continuous',
        metric: `${pendingHumanReview} pending AI reviews`,
        highlights: [
          `${totalInteractions} AI interactions have information-only guardrails recorded.`,
          `${citedInteractions} interactions include citations for source-backed review.`,
          `${redactionRequests} PII redaction requests have been processed through the AI layer.`
        ]
      },
      {
        id: 'translation-quality',
        label: 'Translation Quality',
        status: translationRequests > 0 ? 'Monitored' : 'Ready',
        summary: 'Validate translation acceptability and community fitness across the supported languages.',
        owner: 'Multilingual QA',
        cadence: 'Per model and content update',
        metric: `${translationRequests} translation requests across ${languageCount || 0} recorded languages`,
        highlights: [
          languageCount > 0
            ? `Observed AI languages: ${languages.join(', ')}.`
            : 'No live AI language spread is recorded yet.',
          `Configured transcription model: ${env.OPENAI_TRANSCRIPTION_MODEL}.`,
          'Translation quality remains connected to language-pack and community-review workflows.'
        ]
      },
      {
        id: 'bias-fairness',
        label: 'Bias & Fairness',
        status: humanReviewTriage > 0 || lowConfidenceTriage > 0 ? 'Priority' : 'Ready',
        summary: 'Run bias audits and red-team checks that protect diverse Australian communities from harmful model behavior.',
        owner: 'Responsible AI',
        cadence: 'Quarterly and pre-release',
        metric: `${triageCategories.length} triage categories observed`,
        highlights: [
          triageCategories.length > 0
            ? `Observed categories: ${triageCategories.join(', ')}.`
            : 'No live triage categories are recorded yet.',
          `${humanReviewTriage} triage records recommend human review.`,
          'Fairness review should compare category, language, and safety-risk patterns before release.'
        ]
      },
      {
        id: 'human-in-loop',
        label: 'Human-in-Loop',
        status: pendingHumanReview > 0 ? 'Priority' : 'Ready',
        summary: 'Define when humans intervene, approve, or correct AI outputs before they affect real users or partners.',
        owner: 'Operations Review Team',
        cadence: 'Continuous',
        metric: `${pendingHumanReview} pending, ${approvedReviews} approved, ${rejectedReviews} rejected`,
        highlights: [
          `${pendingHumanReview} AI interactions are waiting for human review.`,
          `${approvedReviews} AI interactions have been approved and ${rejectedReviews} rejected.`,
          'Review queues should prioritize legal, crisis, safety, and low-confidence outcomes.'
        ]
      },
      {
        id: 'model-deployment',
        label: 'Model Deployment',
        status: deploymentSafetyStatus,
        summary: 'Control releases with A/B testing, rollback readiness, and post-release validation.',
        owner: 'AI Platform',
        cadence: 'Per deployment',
        metric: openAiConfigured ? `Model ${env.OPENAI_MODEL}` : 'OPENAI_API_KEY is not configured',
        highlights: [
          `Active response model: ${activeModels}.`,
          `Embedding model: ${env.OPENAI_EMBEDDING_MODEL}; vector index: ${env.RAG_VECTOR_INDEX}.`,
          ragReady
            ? `${ragChunks} embedded RAG chunks are available from approved sources.`
            : 'RAG retrieval still needs approved sources and embedded chunks before it is production-ready.'
        ]
      }
    ],
    quickLinks: [
      {
        label: 'Taxonomies Management',
        to: '/admin/platform-intelligence/taxonomies-management',
        description: 'Confirm the AI system uses the same controlled vocabulary as operations.'
      },
      {
        label: 'Language Packs',
        to: '/admin/platform-intelligence/language-packs',
        description: 'Review multilingual workflows, localization, and community testing.'
      },
      {
        label: 'Legal Compliance',
        to: '/admin/security-compliance/legal-compliance',
        description: 'Keep disclaimer governance and youth-safe safeguards aligned with AI behavior.'
      },
      {
        label: 'Content Moderation',
        to: '/admin/crisis-safety/content-moderation',
        description: 'Route harmful or uncertain AI outputs into the human review queue.'
      }
    ],
    watchlistTitle: 'AI Ops Watchlist',
    watchlist: [
      lowConfidenceTriage > 0
        ? `${lowConfidenceTriage} triage outputs are below target and need review.`
        : 'No below-target triage confidence records are currently visible.',
      pendingHumanReview > 0
        ? `${pendingHumanReview} AI interactions are pending human review.`
        : 'No AI interaction is currently pending human review.',
      openAiConfigured
        ? 'OpenAI API access is configured; keep rollback and model-change reviews active.'
        : 'OPENAI_API_KEY is missing, so live AI generation will fail until configured.'
    ],
    footerNote:
      'Live values are aggregated from AI interaction records, conversation-flow triage, approved RAG knowledge sources, RAG chunks, and model configuration. Raw prompts, outputs, and secrets are not returned.'
  };
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

export const getIntelligenceCenterOverview = async (
  context: AdminServiceContext
): Promise<Record<string, unknown>> => {
  const analyticsQuery: AnalyticsQueryInput = {};
  const [
    overview,
    heatmap,
    trends,
    categories,
    languages,
    activeDestinations,
    activeSubmissionTemplates,
    reportSubmissions,
    openPrivacyReviews
  ] = await Promise.all([
    getAnalyticsOverview(context, analyticsQuery),
    getAnalyticsHeatmap(context, analyticsQuery),
    getAnalyticsTrends(context, analyticsQuery),
    getAnalyticsCategories(context, analyticsQuery),
    getAnalyticsLanguages(context, analyticsQuery),
    AdminDestinationModel.countDocuments({ isActive: true }),
    AdminSubmissionTemplateModel.countDocuments({ isActive: true }),
    ReportSubmissionModel.countDocuments({}),
    PrivacyRequestModel.countDocuments({ status: { $in: ['pending', 'in_review'] } })
  ]);
  const totalReports = getCountValue(overview.totalReports);
  const heatmapCells = heatmap.length;
  const trendBuckets = trends.length;
  const visibleCategories = categories.length;
  const visibleLanguages = languages.length;
  const topCategory = getTopAnalyticsLabel(categories, 'No visible category yet');
  const topLanguage = getTopAnalyticsLabel(languages, 'No visible language yet');

  await audit(context, ADMIN_ACTIONS.intelligenceCenterOverview, undefined, {
    totalReports,
    heatmapCells,
    trendBuckets,
    visibleCategories,
    visibleLanguages
  });

  return {
    eyebrow: 'Analytics & Intelligence Center',
    title: 'Intelligence Center',
    description:
      `${formatCount(totalReports)} anonymised report${totalReports === 1 ? '' : 's'} are currently available for privacy-safe insight, with suppressed low-count cohorts and shared reporting controls.`,
    statusNote:
      heatmapCells > 0
        ? `${formatCount(heatmapCells)} heatmap cell${heatmapCells === 1 ? '' : 's'} currently meet the minimum cohort threshold`
        : 'No heatmap cells currently meet the minimum cohort threshold',
    stats: [
      {
        label: 'REPORTS IN SCOPE',
        value: formatCount(totalReports),
        helper: 'Only reports with anonymised analytics consent are included.'
      },
      {
        label: 'HEATMAP CELLS',
        value: formatCount(heatmapCells),
        helper: 'Locations below n>=5 are suppressed before display.'
      },
      {
        label: 'TREND BUCKETS',
        value: formatCount(trendBuckets),
        helper: 'Daily buckets are generated from the current analytics-safe report set.'
      },
      {
        label: 'VISIBLE SIGNALS',
        value: formatCount(visibleCategories + visibleLanguages),
        helper: `${formatCount(visibleCategories)} categories and ${formatCount(visibleLanguages)} language signals are above threshold.`
      }
    ],
    modules: [
      {
        id: 'advanced-heatmaps',
        label: 'Advanced Heatmaps',
        status: heatmapCells > 0 ? 'Active' : 'Ready',
        summary:
          heatmapCells > 0
            ? `${formatCount(heatmapCells)} geography cells are visible after low-count suppression.`
            : 'Geography cells will appear after enough opted-in reports meet the privacy threshold.',
        owner: 'Analytics Team',
        cadence: 'Weekly refresh',
        metric: `${formatCount(heatmapCells)} cells above n>=5`,
        highlights: [
          `${formatCount(totalReports)} consented reports are eligible for aggregate geography analysis.`,
          'Low-count locations remain suppressed before geographic insights are shared.',
          `Top visible category: ${topCategory}.`
        ]
      },
      {
        id: 'temporal-analytics',
        label: 'Temporal Analytics',
        status: trendBuckets > 0 ? 'Monitored' : 'Ready',
        summary:
          trendBuckets > 0
            ? `${formatCount(trendBuckets)} time buckets are available for surge and seasonality review.`
            : 'Temporal analytics will populate as report activity creates trend buckets.',
        owner: 'Intelligence Operations',
        cadence: 'Daily trend review',
        metric: `${formatCount(trendBuckets)} trend buckets`,
        highlights: [
          'Trend buckets use the same consent and deletion filters as the analytics overview.',
          'Operational surge review stays separated from individual case handling.',
          `Current analytics base: ${formatCount(totalReports)} report${totalReports === 1 ? '' : 's'}.`
        ]
      },
      {
        id: 'community-insights',
        label: 'Community Insights',
        status: visibleLanguages > 0 || visibleCategories > 0 ? 'Priority' : 'Ready',
        summary:
          `${formatCount(visibleCategories)} category signal${visibleCategories === 1 ? '' : 's'} and ${formatCount(visibleLanguages)} language signal${visibleLanguages === 1 ? '' : 's'} are visible above threshold.`,
        owner: 'Community Analytics',
        cadence: 'Monthly review',
        metric: `Top language signal: ${topLanguage}`,
        highlights: [
          'Community insight excludes reports without anonymised analytics consent.',
          'Language and category breakdowns suppress cohorts below n>=5.',
          `Visible category signals: ${formatCount(visibleCategories)}.`
        ]
      },
      {
        id: 'differential-privacy',
        label: 'Differential Privacy',
        status: 'Active',
        summary:
          'Low-count suppression is active across heatmap, category, and language analytics outputs.',
        owner: 'Privacy and Analytics',
        cadence: 'Before any external export',
        metric: 'Minimum cell threshold n>=5',
        highlights: [
          `${formatCount(openPrivacyReviews)} privacy review${openPrivacyReviews === 1 ? '' : 's'} are currently open or in review.`,
          'Analytics exports remain admin-only and audit logged.',
          'Suppression is applied before insight data leaves the analytics layer.'
        ]
      },
      {
        id: 'partner-dashboards',
        label: 'Partner Dashboards',
        status: activeDestinations > 0 ? 'Active' : 'Ready',
        summary:
          `${formatCount(activeDestinations)} active service destination${activeDestinations === 1 ? '' : 's'} and ${formatCount(activeSubmissionTemplates)} active submission template${activeSubmissionTemplates === 1 ? '' : 's'} are available for scoped partner workflows.`,
        owner: 'Partnership Analytics',
        cadence: 'Per agreement',
        metric: `${formatCount(reportSubmissions)} report submission${reportSubmissions === 1 ? '' : 's'} recorded`,
        highlights: [
          'Partner views should stay bound to approved destinations and templates.',
          'Shared analytics should use aggregate insight, not raw report payloads.',
          `${formatCount(activeSubmissionTemplates)} active submission templates can support scoped reporting.`
        ]
      },
      {
        id: 'policy-impact',
        label: 'Policy Impact',
        status: trendBuckets > 0 || visibleCategories > 0 ? 'Monitored' : 'Ready',
        summary:
          'Policy reporting can use visible trend, category, language, and heatmap signals once they clear privacy thresholds.',
        owner: 'Policy Partnerships',
        cadence: 'Quarterly',
        metric: `${formatCount(visibleCategories + trendBuckets)} policy signal bucket${visibleCategories + trendBuckets === 1 ? '' : 's'}`,
        highlights: [
          `Visible category signals: ${formatCount(visibleCategories)}.`,
          `Visible heatmap cells: ${formatCount(heatmapCells)}.`,
          'Policy reporting remains separate from operational case handling.'
        ]
      }
    ],
    quickLinks: [
      {
        label: 'Incident Insights & Trends',
        to: '/admin/insights/incident-trends',
        description: `${formatCount(trendBuckets)} trend buckets are currently available for comparison.`
      },
      {
        label: 'Platform Health',
        to: '/admin/insights/platform-health',
        description: 'Check whether performance or outages could be distorting the analytics picture.'
      },
      {
        label: 'Privacy Controls',
        to: '/admin/security-compliance/privacy-controls',
        description: `${formatCount(openPrivacyReviews)} privacy review${openPrivacyReviews === 1 ? '' : 's'} are pending or in review.`
      },
      {
        label: 'Taxonomies Management',
        to: '/admin/platform-intelligence/taxonomies-management',
        description: `Current top visible category signal: ${topCategory}.`
      }
    ],
    watchlistTitle: 'Intelligence Guardrails',
    watchlist: [
      `Minimum cell suppression is n>=5; ${formatCount(heatmapCells)} heatmap cells are currently visible.`,
      `${formatCount(totalReports)} consented reports are eligible for aggregate analytics.`,
      `${formatCount(activeDestinations)} active partner destination${activeDestinations === 1 ? '' : 's'} should remain scoped by agreement and consent.`
    ],
    footerNote:
      'Live values are aggregated from consented reports, analytics-safe buckets, privacy reviews, destinations, submission templates, and report submission telemetry. Raw report payloads and personal data are not returned by this endpoint.'
  };
};

export const getAdminAnalyticsOverview = async (
  context: AdminServiceContext,
  query: AnalyticsQueryInput
): Promise<Record<string, unknown>> => {
  const overview = await getAnalyticsOverview(context, query);

  await audit(context, ADMIN_ACTIONS.analyticsOverview);

  return overview;
};
