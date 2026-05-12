import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  CreateAdminUserInput,
  DestinationInput,
  PrivacyRequestQueryInput,
  SubmissionTemplateInput,
  TaxonomyInput,
  UpdateAdminUserInput,
  UpdateDestinationInput,
  UpdatePrivacyRequestInput,
  UpdateSubmissionTemplateInput,
  UpdateTaxonomyInput,
  UsersQueryInput
} from './admin.schema';
import {
  createAdminUser,
  createDestination,
  createSubmissionTemplate,
  createTaxonomy,
  getEducationalContentOverview,
  getAdminAnalyticsOverview,
  getAdminDashboard,
  listDestinations,
  listKnowledgeSourcesForAdmin,
  listPrivacyRequests,
  listSubmissionTemplates,
  listTaxonomies,
  listUsers,
  updateAdminUser,
  updateDestination,
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
