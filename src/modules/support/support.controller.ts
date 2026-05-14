import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { asyncHandler } from '@common/errors/asyncHandler';
import { successResponse } from '@common/responses/api-response';

import type {
  AdminWarmReferralQueryInput,
  AdvocateRequestInput,
  RecommendationsInput,
  SafetyPlanInput,
  SupportServiceInput,
  UpdateSafetyPlanInput,
  UpdateSupportServiceInput,
  UpdateWarmReferralStatusInput,
  WarmReferralInput
} from './support.schema';
import {
  createAdvocateRequest,
  createSafetyPlan,
  createSupportService,
  createWarmReferral,
  deleteSupportService,
  getRecommendations,
  getSupportServiceById,
  listAdvocates,
  listAdminSupportServices,
  listAdminWarmReferrals,
  listSafetyPlans,
  listSupportServices,
  updateWarmReferralStatus,
  updateSupportService,
  updateSafetyPlan
} from './support.service';

const getContext = (req: Request) => ({
  owner: {
    userId: req.user?.id,
    sessionId: req.session?.id
  },
  ip: req.ip,
  userAgent: req.get('user-agent')
});

const getAdminContext = (req: Request) => ({
  adminUserId: req.user?.id ?? '',
  ip: req.ip,
  userAgent: req.get('user-agent')
});

export const listAdminServicesController = asyncHandler(async (req: Request, res: Response) => {
  const services = await listAdminSupportServices(getAdminContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Support services retrieved', { services }));
});

export const createAdminServiceController = asyncHandler(async (req: Request, res: Response) => {
  const service = await createSupportService(getAdminContext(req), req.body as SupportServiceInput);

  res.status(StatusCodes.CREATED).json(successResponse('Support service created', { service }));
});

export const updateAdminServiceController = asyncHandler(async (req: Request, res: Response) => {
  const service = await updateSupportService(
    getAdminContext(req),
    req.params.id,
    req.body as UpdateSupportServiceInput
  );

  res.status(StatusCodes.OK).json(successResponse('Support service updated', { service }));
});

export const deleteAdminServiceController = asyncHandler(async (req: Request, res: Response) => {
  await deleteSupportService(getAdminContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Support service deleted', null));
});

export const listAdminWarmReferralsController = asyncHandler(
  async (req: Request, res: Response) => {
    const referrals = await listAdminWarmReferrals(
      getAdminContext(req),
      req.query as unknown as AdminWarmReferralQueryInput
    );

    res.status(StatusCodes.OK).json(successResponse('Warm referrals retrieved', { referrals }));
  }
);

export const updateAdminWarmReferralController = asyncHandler(
  async (req: Request, res: Response) => {
    const referral = await updateWarmReferralStatus(
      getAdminContext(req),
      req.params.id,
      req.body as UpdateWarmReferralStatusInput
    );

    res.status(StatusCodes.OK).json(successResponse('Warm referral updated', { referral }));
  }
);

export const listServicesController = asyncHandler(async (req: Request, res: Response) => {
  const services = await listSupportServices(getContext(req), req.query);

  res.status(StatusCodes.OK).json(successResponse('Support services retrieved', { services }));
});

export const getServiceController = asyncHandler(async (req: Request, res: Response) => {
  const service = await getSupportServiceById(getContext(req), req.params.id);

  res.status(StatusCodes.OK).json(successResponse('Support service retrieved', { service }));
});

export const recommendationsController = asyncHandler(async (req: Request, res: Response) => {
  const recommendations = await getRecommendations(
    getContext(req),
    req.body as RecommendationsInput
  );

  res
    .status(StatusCodes.OK)
    .json(successResponse('Support recommendations retrieved', { recommendations }));
});

export const warmReferralController = asyncHandler(async (req: Request, res: Response) => {
  const referral = await createWarmReferral(getContext(req), req.body as WarmReferralInput);

  res.status(StatusCodes.CREATED).json(successResponse('Warm referral requested', { referral }));
});

export const listAdvocatesController = asyncHandler(async (req: Request, res: Response) => {
  const advocates = await listAdvocates(getContext(req));

  res.status(StatusCodes.OK).json(successResponse('Support advocates retrieved', { advocates }));
});

export const advocateRequestController = asyncHandler(async (req: Request, res: Response) => {
  const request = await createAdvocateRequest(getContext(req), req.body as AdvocateRequestInput);

  res.status(StatusCodes.CREATED).json(successResponse('Advocate request created', { request }));
});

export const listSafetyPlansController = asyncHandler(async (req: Request, res: Response) => {
  const safetyPlans = await listSafetyPlans(getContext(req));

  res.status(StatusCodes.OK).json(successResponse('Safety plans retrieved', { safetyPlans }));
});

export const createSafetyPlanController = asyncHandler(async (req: Request, res: Response) => {
  const safetyPlan = await createSafetyPlan(getContext(req), req.body as SafetyPlanInput);

  res.status(StatusCodes.CREATED).json(successResponse('Safety plan created', { safetyPlan }));
});

export const updateSafetyPlanController = asyncHandler(async (req: Request, res: Response) => {
  const safetyPlan = await updateSafetyPlan(
    getContext(req),
    req.params.id,
    req.body as UpdateSafetyPlanInput
  );

  res.status(StatusCodes.OK).json(successResponse('Safety plan updated', { safetyPlan }));
});
