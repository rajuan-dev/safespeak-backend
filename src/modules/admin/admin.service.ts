import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { UserModel } from '@modules/auth/auth.model';
import { deriveFullNameFromEmail, hashPassword } from '@modules/auth/auth.utils';
import { createAuditLog } from '@modules/audit/audit.service';
import { getAnalyticsOverview } from '@modules/analytics/analytics.service';
import type { AnalyticsQueryInput } from '@modules/analytics/analytics.schema';
import { ContentResourceModel } from '@modules/content-resources/content-resources.model';
import { MediaAssetModel } from '@modules/media-assets/media-assets.model';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';
import { ResourceModel } from '@modules/resources/resources.model';
import { ReportModel } from '@modules/reports/reports.model';

import { ADMIN_ACTIONS } from './admin.constants';
import {
  AdminDestinationModel,
  AdminSubmissionTemplateModel,
  AdminTaxonomyModel,
  PrivacyRequestModel
} from './admin.model';
import type {
  DestinationInput,
  DestinationQueryInput,
  CreateAdminUserInput,
  PrivacyRequestQueryInput,
  SubmissionTemplateInput,
  SubmissionTemplateQueryInput,
  TaxonomyInput,
  TaxonomyQueryInput,
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
