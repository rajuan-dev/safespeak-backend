import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import {
  DEFAULT_SUPPORT_SERVICES,
  SUPPORT_ACTIONS,
  type SupportServiceDefinition
} from './support.constants';
import { AdvocateRequestModel, SafetyPlanModel, WarmReferralModel } from './support.model';
import type {
  AdvocateRequestInput,
  RecommendationsInput,
  SafetyPlanInput,
  ServicesQueryInput,
  UpdateSafetyPlanInput,
  WarmReferralInput
} from './support.schema';
import type { SupportOwner, SupportServiceContext } from './support.types';

const ownerFilter = (owner: SupportOwner): SupportOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const audit = async (
  context: SupportServiceContext,
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

const assertWarmReferralConsent = async (owner: SupportOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.warm_referral) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'warm_referral consent is required');
  }
};

export const listSupportServices = async (
  context: SupportServiceContext,
  query: ServicesQueryInput
): Promise<SupportServiceDefinition[]> => {
  ownerFilter(context.owner);
  const services = DEFAULT_SUPPORT_SERVICES.filter((service) => {
    if (query.type && service.type !== query.type) {
      return false;
    }

    if (query.jurisdiction && service.jurisdiction !== query.jurisdiction) {
      return false;
    }

    if (query.language && !service.languages.includes(query.language)) {
      return false;
    }

    return true;
  });

  await audit(context, SUPPORT_ACTIONS.servicesList, undefined, { count: services.length });

  return services;
};

export const getSupportServiceById = async (
  context: SupportServiceContext,
  serviceId: string
): Promise<unknown> => {
  ownerFilter(context.owner);
  const service = DEFAULT_SUPPORT_SERVICES.find((item) => item.id === serviceId);

  if (!service) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Support service not found');
  }

  await audit(context, SUPPORT_ACTIONS.serviceGet, undefined, { serviceId });

  return service;
};

export const getRecommendations = async (
  context: SupportServiceContext,
  input: RecommendationsInput
): Promise<unknown[]> => {
  ownerFilter(context.owner);
  const services = await listSupportServices(context, {
    jurisdiction: input.jurisdiction,
    language: input.language
  });
  const filtered = input.needs.length
    ? services.filter((service) => input.needs.includes(service.type))
    : services;

  await audit(context, SUPPORT_ACTIONS.recommendations, input.reportId, {
    needs: input.needs,
    count: filtered.length
  });

  return filtered;
};

export const createWarmReferral = async (
  context: SupportServiceContext,
  input: WarmReferralInput
): Promise<unknown> => {
  await assertWarmReferralConsent(context.owner);
  await getSupportServiceById(context, input.serviceId);
  const referral = await WarmReferralModel.create({
    ...ownerFilter(context.owner),
    ...input,
    status: 'pending'
  });

  await audit(context, SUPPORT_ACTIONS.warmReferral, referral._id.toString(), {
    serviceId: input.serviceId
  });

  return referral;
};

export const listAdvocates = async (context: SupportServiceContext): Promise<unknown[]> => {
  ownerFilter(context.owner);
  const advocates = [
    {
      id: 'general-support',
      advocateType: 'general_support',
      languages: ['en'],
      availability: 'request_based',
      informationOnly: true
    },
    {
      id: 'multilingual-support',
      advocateType: 'multilingual_support',
      languages: ['en', 'ar', 'es'],
      availability: 'request_based',
      informationOnly: true
    }
  ];

  await audit(context, SUPPORT_ACTIONS.advocatesList, undefined, { count: advocates.length });

  return advocates;
};

export const createAdvocateRequest = async (
  context: SupportServiceContext,
  input: AdvocateRequestInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const request = await AdvocateRequestModel.create({
    ...ownerFilter(context.owner),
    ...input,
    status: 'pending'
  });

  await audit(context, SUPPORT_ACTIONS.advocateRequest, request._id.toString(), {
    advocateType: input.advocateType
  });

  return request;
};

export const listSafetyPlans = async (context: SupportServiceContext): Promise<unknown[]> => {
  const safetyPlans = await SafetyPlanModel.find(ownerFilter(context.owner))
    .sort({ createdAt: -1 })
    .lean();

  await audit(context, SUPPORT_ACTIONS.safetyPlanList, undefined, { count: safetyPlans.length });

  return safetyPlans;
};

export const createSafetyPlan = async (
  context: SupportServiceContext,
  input: SafetyPlanInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const safetyPlan = await SafetyPlanModel.create({
    ...ownerFilter(context.owner),
    ...input
  });

  await audit(context, SUPPORT_ACTIONS.safetyPlanCreate, safetyPlan._id.toString());

  return safetyPlan;
};

export const updateSafetyPlan = async (
  context: SupportServiceContext,
  safetyPlanId: string,
  input: UpdateSafetyPlanInput
): Promise<unknown> => {
  const safetyPlan = await SafetyPlanModel.findOne({
    _id: safetyPlanId,
    ...ownerFilter(context.owner)
  });

  if (!safetyPlan) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Safety plan not found');
  }

  safetyPlan.set(input);
  await safetyPlan.save();
  await audit(context, SUPPORT_ACTIONS.safetyPlanUpdate, safetyPlan._id.toString(), {
    changedFields: Object.keys(input)
  });

  return safetyPlan;
};
