import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  AdminNotificationsQueryInput,
  AuditLogsQueryInput,
  CulturalProfileInput,
  CulturalProfileQueryInput,
  CreateAdminUserInput,
  DestinationInput,
  MarkAdminNotificationReadInput,
  MarkAdminNotificationsReadInput,
  PrivacyRequestQueryInput,
  ReportDeliveryQueryInput,
  SubmissionTemplateInput,
  TaxonomyInput,
  UpdateCulturalProfileInput,
  UpdateAdminUserInput,
  UpdateDestinationInput,
  UpdatePrivacyRequestInput,
  UpdateSubmissionTemplateInput,
  UpdateTaxonomyInput,
  UsersQueryInput
} from './admin.schema';
import {
  createCulturalProfile,
  createAdminUser,
  createDestination,
  createSubmissionTemplate,
  createTaxonomy,
  deleteCulturalProfile,
  deleteTaxonomy,
  getAiEngineOverview,
  getCulturalProfilesOverview,
  getDataProtectionOverview,
  getEducationalContentOverview,
  getAdminAnalyticsOverview,
  getAdminDashboard,
  getIntelligenceCenterOverview,
  getLanguagePacksOverview,
  getPlatformHealthOverview,
  getTaxonomy,
  listAuditLogs,
  listDestinations,
  listCulturalProfiles,
  listKnowledgeSourcesForAdmin,
  listAdminNotifications,
  listPrivacyRequests,
  listReportDeliveries,
  listSubmissionTemplates,
  listTaxonomies,
  listUsers,
  updateAdminUser,
  updateCulturalProfile,
  updateDestination,
  markAdminNotificationRead,
  markAdminNotificationsRead,
  updatePrivacyRequest,
  updateSubmissionTemplate,
  updateTaxonomy
} from './admin.service';

const getContext = (req: Request) => ({
  actor: {
    userId: req.user?.id ?? ''
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const adminDashboardController = asyncHandler(async (req: Request, res: Response) => {
  const dashboard = await getAdminDashboard(getContext(req));

  res.status(StatusCodes.OK).json(successResponse('Admin dashboard retrieved', { dashboard }));
});

export const adminAuditLogsController = asyncHandler(async (req: Request, res: Response) => {
  const auditLogs = await listAuditLogs(
    getContext(req),
    req.query as unknown as AuditLogsQueryInput
  );

  res.status(StatusCodes.OK).json(successResponse('Admin audit logs retrieved', { auditLogs }));
});

export const adminNotificationsController = asyncHandler(async (req: Request, res: Response) => {
  const notifications = await listAdminNotifications(
    getContext(req),
    req.query as unknown as AdminNotificationsQueryInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Admin notifications retrieved', { notifications }));
});

export const markAdminNotificationReadController = asyncHandler(
  async (req: Request, res: Response) => {
    const readReceipt = await markAdminNotificationRead(
      getContext(req),
      req.body as MarkAdminNotificationReadInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin notification marked read', { readReceipt }));
  }
);

export const markAdminNotificationsReadController = asyncHandler(
  async (req: Request, res: Response) => {
    const readReceipt = await markAdminNotificationsRead(
      getContext(req),
      req.body as MarkAdminNotificationsReadInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin notifications marked read', { readReceipt }));
  }
);

export const adminUsersController = asyncHandler(async (req: Request, res: Response) => {
  const users = await listUsers(getContext(req), req.query as unknown as UsersQueryInput);

  res.status(StatusCodes.OK).json(successResponse('Admin users retrieved', { users }));
});

export const createAdminUserController = asyncHandler(async (req: Request, res: Response) => {
  const user = await createAdminUser(getContext(req), req.body as CreateAdminUserInput);

  res.status(StatusCodes.CREATED).json(successResponse('Admin user created', { user }));
});

export const updateAdminUserController = asyncHandler(async (req: Request, res: Response) => {
  const user = await updateAdminUser(getContext(req), req.params.id, req.body as UpdateAdminUserInput);

  res.status(StatusCodes.OK).json(successResponse('Admin user updated', { user }));
});

export const adminTaxonomiesController = asyncHandler(async (req: Request, res: Response) => {
  const taxonomies = await listTaxonomies(getContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Admin taxonomies retrieved', { taxonomies }));
});

export const adminTaxonomyController = asyncHandler(async (req: Request, res: Response) => {
  const taxonomy = await getTaxonomy(getContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Admin taxonomy retrieved', { taxonomy }));
});

export const createAdminTaxonomyController = asyncHandler(async (req: Request, res: Response) => {
  const taxonomy = await createTaxonomy(getContext(req), req.body as TaxonomyInput);

  res.status(StatusCodes.CREATED).json(successResponse('Admin taxonomy created', { taxonomy }));
});

export const updateAdminTaxonomyController = asyncHandler(async (req: Request, res: Response) => {
  const taxonomy = await updateTaxonomy(
    getContext(req),
    req.params.id,
    req.body as UpdateTaxonomyInput
  );

  res.status(StatusCodes.OK).json(successResponse('Admin taxonomy updated', { taxonomy }));
});

export const deleteAdminTaxonomyController = asyncHandler(async (req: Request, res: Response) => {
  const taxonomy = await deleteTaxonomy(getContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Admin taxonomy deleted', { taxonomy }));
});

export const adminCulturalProfilesOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const culturalProfiles = await getCulturalProfilesOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin cultural profiles overview retrieved', { culturalProfiles }));
  }
);

export const adminCulturalProfilesController = asyncHandler(
  async (req: Request, res: Response) => {
    const culturalProfiles = await listCulturalProfiles(
      getContext(req),
      req.query as unknown as CulturalProfileQueryInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin cultural profiles retrieved', { culturalProfiles }));
  }
);

export const createAdminCulturalProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const culturalProfile = await createCulturalProfile(
      getContext(req),
      req.body as CulturalProfileInput
    );

    res
      .status(StatusCodes.CREATED)
      .json(successResponse('Admin cultural profile created', { culturalProfile }));
  }
);

export const updateAdminCulturalProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const culturalProfile = await updateCulturalProfile(
      getContext(req),
      req.params.id,
      req.body as UpdateCulturalProfileInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin cultural profile updated', { culturalProfile }));
  }
);

export const deleteAdminCulturalProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const culturalProfile = await deleteCulturalProfile(getContext(req), req.params.id);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin cultural profile deleted', { culturalProfile }));
  }
);

export const adminDestinationsController = asyncHandler(async (req: Request, res: Response) => {
  const destinations = await listDestinations(getContext(req), req.query);

  res
    .status(StatusCodes.OK)
    .json(successResponse('Admin destinations retrieved', { destinations }));
});

export const createAdminDestinationController = asyncHandler(
  async (req: Request, res: Response) => {
    const destination = await createDestination(getContext(req), req.body as DestinationInput);

    res
      .status(StatusCodes.CREATED)
      .json(successResponse('Admin destination created', { destination }));
  }
);

export const updateAdminDestinationController = asyncHandler(
  async (req: Request, res: Response) => {
    const destination = await updateDestination(
      getContext(req),
      req.params.id,
      req.body as UpdateDestinationInput
    );

    res.status(StatusCodes.OK).json(successResponse('Admin destination updated', { destination }));
  }
);

export const adminSubmissionTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const templates = await listSubmissionTemplates(getContext(req), req.query);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin submission templates retrieved', { templates }));
  }
);

export const createAdminSubmissionTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const template = await createSubmissionTemplate(
      getContext(req),
      req.body as SubmissionTemplateInput
    );

    res
      .status(StatusCodes.CREATED)
      .json(successResponse('Admin submission template created', { template }));
  }
);

export const updateAdminSubmissionTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const template = await updateSubmissionTemplate(
      getContext(req),
      req.params.id,
      req.body as UpdateSubmissionTemplateInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin submission template updated', { template }));
  }
);

export const adminReportDeliveriesController = asyncHandler(
  async (req: Request, res: Response) => {
    const deliveries = await listReportDeliveries(
      getContext(req),
      req.query as unknown as ReportDeliveryQueryInput
    );

    res.status(StatusCodes.OK).json(successResponse('Admin report deliveries retrieved', {
      deliveries
    }));
  }
);

export const adminKnowledgeSourcesController = asyncHandler(async (req: Request, res: Response) => {
  const knowledgeSources = await listKnowledgeSourcesForAdmin(getContext(req));

  res
    .status(StatusCodes.OK)
    .json(successResponse('Admin knowledge sources retrieved', { knowledgeSources }));
});

export const adminEducationalContentController = asyncHandler(
  async (req: Request, res: Response) => {
    const educationalContent = await getEducationalContentOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin educational content overview retrieved', { educationalContent }));
  }
);

export const adminDataProtectionOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const dataProtection = await getDataProtectionOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin data protection overview retrieved', { dataProtection }));
  }
);

export const adminAiEngineOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const aiEngine = await getAiEngineOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin AI engine overview retrieved', { aiEngine }));
  }
);

export const adminLanguagePacksOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const languagePacks = await getLanguagePacksOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin language packs overview retrieved', { languagePacks }));
  }
);

export const adminIntelligenceCenterOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const intelligenceCenter = await getIntelligenceCenterOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(
        successResponse('Admin intelligence center overview retrieved', { intelligenceCenter })
      );
  }
);

export const adminPlatformHealthOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const platformHealth = await getPlatformHealthOverview(getContext(req));

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin platform health overview retrieved', { platformHealth }));
  }
);

export const adminPrivacyRequestsController = asyncHandler(async (req: Request, res: Response) => {
  const privacyRequests = await listPrivacyRequests(
    getContext(req),
    req.query as unknown as PrivacyRequestQueryInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Admin privacy requests retrieved', { privacyRequests }));
});

export const updateAdminPrivacyRequestController = asyncHandler(
  async (req: Request, res: Response) => {
    const privacyRequest = await updatePrivacyRequest(
      getContext(req),
      req.params.id,
      req.body as UpdatePrivacyRequestInput
    );

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin privacy request updated', { privacyRequest }));
  }
);

export const adminAnalyticsOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const overview = await getAdminAnalyticsOverview(getContext(req), req.query);

    res
      .status(StatusCodes.OK)
      .json(successResponse('Admin analytics overview retrieved', { overview }));
  }
);
