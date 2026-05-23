import { StatusCodes } from 'http-status-codes';
import { isValidObjectId, type FilterQuery } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import {
  DEFAULT_SUPPORT_SERVICES,
  SUPPORT_ACTIONS,
  type SupportServiceDefinition
} from './support.constants';
import {
  AdvocateRequestModel,
  HelpSupportRequestModel,
  SafetyPlanModel,
  SupportServiceModel,
  type SupportServiceDocument,
  type WarmReferralDocument,
  WarmReferralModel
} from './support.model';
import type {
  AdminServicesQueryInput,
  AdminWarmReferralQueryInput,
  AdvocateRequestInput,
  HelpSupportRequestInput,
  RecommendationsInput,
  SafetyPlanInput,
  ServicesQueryInput,
  SupportServiceInput,
  UpdateSafetyPlanInput,
  UpdateSupportServiceInput,
  UpdateWarmReferralStatusInput,
  WarmReferralInput
} from './support.schema';
import type {
  AdminSupportServiceContext,
  SupportOwner,
  SupportServiceContext
} from './support.types';

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

const auditAdmin = async (
  context: AdminSupportServiceContext,
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

const assertWarmReferralConsent = async (owner: SupportOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.warm_referral) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'warm_referral consent is required');
  }
};

const maskSafeContact = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value.includes('@')) {
    const [name, domain] = value.split('@');

    return `${name.slice(0, 2)}***@${domain}`;
  }

  const digits = value.replace(/\D/g, '');

  if (digits.length >= 4) {
    return `***${digits.slice(-4)}`;
  }

  return '***';
};

const toSupportServiceRecord = (service: unknown) => {
  const serviceLike = service as { toObject?: () => Record<string, unknown> };
  const record =
    typeof serviceLike.toObject === 'function'
      ? serviceLike.toObject()
      : (service as Record<string, unknown>);
  const key = typeof record.key === 'string' ? record.key : undefined;
  const websiteUrl = typeof record.websiteUrl === 'string' ? record.websiteUrl : undefined;

  return {
    ...record,
    id: key ?? String(record._id),
    url: websiteUrl
  };
};

const normalizeSupportServiceInput = (input: SupportServiceInput | UpdateSupportServiceInput) => {
  const normalized: Record<string, unknown> = { ...input };

  for (const key of ['bookingUrl', 'websiteUrl', 'email', 'cardImageUrl', 'cardImageAlt'] as const) {
    if (normalized[key] === '') {
      delete normalized[key];
    }
  }

  if (!normalized.resourceType && typeof normalized.type === 'string') {
    normalized.resourceType =
      normalized.type === 'crisis'
        ? 'emergency'
        : normalized.type === 'online_safety'
          ? 'online_safety'
          : normalized.type === 'legal_information'
            ? 'legal'
            : normalized.type === 'counselling'
              ? 'mental_health'
              : 'government';
  }

  if (!Array.isArray(normalized.issueTypes) || normalized.issueTypes.length === 0) {
    normalized.issueTypes = ['general_support'];
  }

  if (!Array.isArray(normalized.safetyRiskLevels) || normalized.safetyRiskLevels.length === 0) {
    normalized.safetyRiskLevels = ['all'];
  }

  return normalized;
};

const toWarmReferralAdminRecord = (referral: WarmReferralDocument | Record<string, unknown>) => {
  const record =
    typeof (referral as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (referral as { toObject: () => Record<string, unknown> }).toObject()
      : (referral as Record<string, unknown>);
  const safeContact = typeof record.safeContact === 'string' ? record.safeContact : undefined;

  return {
    ...record,
    safeContact: undefined,
    safeContactMasked: maskSafeContact(safeContact),
    hasSafeContact: Boolean(safeContact)
  };
};

const buildWarmReferralServiceFilter = async (
  serviceId?: string
): Promise<FilterQuery<WarmReferralDocument>> => {
  if (!serviceId) {
    return {};
  }

  const identifiers = new Set<string>([serviceId]);
  const service = await SupportServiceModel.findOne({
    $or: [
      ...(isValidObjectId(serviceId) ? [{ _id: serviceId }] : []),
      { key: serviceId },
      { name: serviceId }
    ]
  })
    .select('_id key name')
    .lean();

  if (service) {
    identifiers.add(String(service._id));
    identifiers.add(service.key);
    identifiers.add(service.name);
  }

  const values = Array.from(identifiers);

  return {
    $or: [
      { serviceId: { $in: values } },
      { partnerKey: { $in: values } },
      { serviceName: { $in: values } }
    ]
  };
};

const normalizeMinimalSummary = (input: WarmReferralInput) => ({
  incidentSummary: input.minimalSummary?.incidentSummary,
  immediateSafetyConcerns: input.minimalSummary?.immediateSafetyConcerns,
  preferredContactMethod: input.minimalSummary?.preferredContactMethod ?? input.contactPreference,
  interpreterPreference: input.minimalSummary?.interpreterPreference,
  culturalContext: input.shareProfileContext ? input.minimalSummary?.culturalContext : undefined,
  informationOnlyDisclaimer: true
});

const getStringField = (record: unknown, field: string): string | undefined => {
  const value = (record as Record<string, unknown>)[field];

  return typeof value === 'string' ? value : undefined;
};

const buildPublicServiceFilter = (
  query: ServicesQueryInput,
  includePublicationFilters = true
): FilterQuery<SupportServiceDocument> => {
  const filter: FilterQuery<SupportServiceDocument> = {};

  if (includePublicationFilters) {
    filter.isPublished = true;
    filter.isActive = true;
  }

  if (query.type) {
    filter.type = query.type;
  }

  if ('resourceType' in query && query.resourceType) {
    filter.resourceType = query.resourceType;
  }

  if ('issueType' in query && query.issueType) {
    filter.issueTypes = query.issueType;
  }

  if (query.jurisdiction) {
    filter.jurisdiction = query.jurisdiction;
  }

  if (query.language) {
    filter.languages = query.language;
  }

  if (query.region) {
    filter.regions = query.region;
  }

  if (query.eligibility) {
    filter.eligibility = query.eligibility;
  }

  if (query.profile) {
    filter.$or = [{ eligibility: query.profile }, { 'metadata.profiles': query.profile }];
  }

  return filter;
};

const filterDefaultServices = (query: ServicesQueryInput): SupportServiceDefinition[] =>
  DEFAULT_SUPPORT_SERVICES.filter((service) => {
    if (query.type && service.type !== query.type) {
      return false;
    }

    if (query.jurisdiction && service.jurisdiction !== query.jurisdiction) {
      return false;
    }

    if (query.language && !service.languages.includes(query.language)) {
      return false;
    }

    if (query.region && !service.regions?.includes(query.region)) {
      return false;
    }

    if (query.eligibility && !service.eligibility?.includes(query.eligibility)) {
      return false;
    }

    if (query.profile && !service.eligibility?.includes(query.profile)) {
      return false;
    }

    return true;
  });

export const listSupportServices = async (
  context: SupportServiceContext,
  query: ServicesQueryInput
): Promise<unknown[]> => {
  ownerFilter(context.owner);
  const serviceDocuments = await SupportServiceModel.find(buildPublicServiceFilter(query))
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const services =
    serviceDocuments.length > 0
      ? serviceDocuments.map((service) => toSupportServiceRecord(service as SupportServiceDocument))
      : filterDefaultServices(query);

  await audit(context, SUPPORT_ACTIONS.servicesList, undefined, { count: services.length });

  return services;
};

export const getSupportServiceById = async (
  context: SupportServiceContext,
  serviceId: string
): Promise<unknown> => {
  ownerFilter(context.owner);
  const service = await SupportServiceModel.findOne({
    ...(isValidObjectId(serviceId) ? { _id: serviceId } : { key: serviceId }),
    isPublished: true,
    isActive: true
  }).lean();

  if (service) {
    await audit(context, SUPPORT_ACTIONS.serviceGet, undefined, { serviceId });

    return toSupportServiceRecord(service);
  }

  const fallbackService = DEFAULT_SUPPORT_SERVICES.find((item) => item.id === serviceId);

  if (!fallbackService) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Support service not found');
  }

  await audit(context, SUPPORT_ACTIONS.serviceGet, undefined, { serviceId });

  return fallbackService;
};

export const listAdminSupportServices = async (
  context: AdminSupportServiceContext,
  query: AdminServicesQueryInput
): Promise<unknown[]> => {
  const filter = buildPublicServiceFilter(query, false);

  if (query.isPublished !== undefined) {
    filter.isPublished = query.isPublished;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive;
  }

  const services = await SupportServiceModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean();

  await auditAdmin(context, SUPPORT_ACTIONS.adminServicesList, undefined, { count: services.length });

  return services.map((service) => toSupportServiceRecord(service as SupportServiceDocument));
};

export const createSupportService = async (
  context: AdminSupportServiceContext,
  input: SupportServiceInput
): Promise<unknown> => {
  const service = await SupportServiceModel.create(normalizeSupportServiceInput(input));

  await auditAdmin(context, SUPPORT_ACTIONS.adminServiceCreate, service._id.toString(), {
    key: service.key,
    type: service.type,
    isPublished: service.isPublished
  });

  return toSupportServiceRecord(service);
};

export const updateSupportService = async (
  context: AdminSupportServiceContext,
  serviceId: string,
  input: UpdateSupportServiceInput
): Promise<unknown> => {
  const service = await SupportServiceModel.findByIdAndUpdate(
    serviceId,
    { $set: normalizeSupportServiceInput(input) },
    { new: true, runValidators: true }
  );

  if (!service) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Support service not found');
  }

  await auditAdmin(context, SUPPORT_ACTIONS.adminServiceUpdate, service._id.toString(), {
    changedFields: Object.keys(input),
    key: service.key,
    isPublished: service.isPublished
  });

  return toSupportServiceRecord(service);
};

export const deleteSupportService = async (
  context: AdminSupportServiceContext,
  serviceId: string
): Promise<void> => {
  const service = await SupportServiceModel.findByIdAndDelete(serviceId);

  if (!service) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Support service not found');
  }

  await auditAdmin(context, SUPPORT_ACTIONS.adminServiceDelete, service._id.toString(), {
    key: service.key,
    name: service.name
  });
};

export const listAdminWarmReferrals = async (
  context: AdminSupportServiceContext,
  query: AdminWarmReferralQueryInput
): Promise<unknown[]> => {
  const filter: FilterQuery<WarmReferralDocument> = await buildWarmReferralServiceFilter(
    query.serviceId
  );

  if (query.status) {
    filter.status = query.status;
  }

  const referrals = await WarmReferralModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

  await auditAdmin(context, SUPPORT_ACTIONS.adminWarmReferralsList, undefined, {
    count: referrals.length,
    status: query.status
  });

  return referrals.map((referral) => toWarmReferralAdminRecord(referral));
};

export const updateWarmReferralStatus = async (
  context: AdminSupportServiceContext,
  referralId: string,
  input: UpdateWarmReferralStatusInput
): Promise<unknown> => {
  const referral = await WarmReferralModel.findByIdAndUpdate(
    referralId,
    {
      $set: {
        status: input.status,
        ...(input.notes ? { 'metadata.adminNotes': input.notes } : {})
      }
    },
    { new: true, runValidators: true }
  );

  if (!referral) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Warm referral not found');
  }

  await auditAdmin(context, SUPPORT_ACTIONS.adminWarmReferralUpdate, referral._id.toString(), {
    status: input.status
  });

  return toWarmReferralAdminRecord(referral);
};

export const getRecommendations = async (
  context: SupportServiceContext,
  input: RecommendationsInput
): Promise<unknown[]> => {
  ownerFilter(context.owner);
  const services = await listSupportServices(context, {
    resourceType: input.resourceTypes[0],
    issueType: input.issueType,
    jurisdiction: input.jurisdiction,
    language: input.language,
    region: input.region,
    eligibility: input.eligibility,
    profile: input.profile
  });
  const filtered = input.needs.length
    ? services.filter((service) => {
        const serviceType = (service as { type?: unknown }).type;

        return (
          typeof serviceType === 'string' &&
          input.needs.includes(serviceType as (typeof input.needs)[number])
        );
      })
    : services.filter((service) => {
        if (input.resourceTypes.length > 0) {
          const resourceType = (service as { resourceType?: unknown }).resourceType;

          if (
            typeof resourceType !== 'string' ||
            !input.resourceTypes.includes(resourceType as (typeof input.resourceTypes)[number])
          ) {
            return false;
          }
        }

        if (input.issueType) {
          const issueTypes = (service as { issueTypes?: unknown }).issueTypes;

          if (
            !Array.isArray(issueTypes) ||
            !issueTypes.some(
              (item) => typeof item === 'string' && (item === input.issueType || item === 'general_support')
            )
          ) {
            return false;
          }
        }

        if (input.safetyRiskLevel) {
          const safetyRiskLevels = (service as { safetyRiskLevels?: unknown }).safetyRiskLevels;

          if (
            !Array.isArray(safetyRiskLevels) ||
            !safetyRiskLevels.some(
              (item) =>
                typeof item === 'string' && (item === input.safetyRiskLevel || item === 'all')
            )
          ) {
            return false;
          }
        }

        return true;
      });

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
  const supportService = await getSupportServiceById(context, input.serviceId);
  const minimalSummary = normalizeMinimalSummary(input);
  const includedFields =
    input.includedFields.length > 0
      ? input.includedFields
      : Object.entries(minimalSummary)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key]) => key);
  const referral = await WarmReferralModel.create({
    ...ownerFilter(context.owner),
    serviceId: input.serviceId,
    serviceName: getStringField(supportService, 'name'),
    serviceType: getStringField(supportService, 'type'),
    partnerKey: getStringField(supportService, 'key') ?? input.serviceId,
    contactPreference: input.contactPreference,
    safeContact: input.safeContact,
    notes: input.notes,
    minimalSummary,
    includedFields,
    shareProfileContext: input.shareProfileContext,
    consentSnapshot: {
      warm_referral: true,
      capturedAt: new Date()
    },
    metadata: input.metadata,
    status: 'pending'
  });

  await audit(context, SUPPORT_ACTIONS.warmReferral, referral._id.toString(), {
    serviceId: input.serviceId,
    includedFields,
    shareProfileContext: input.shareProfileContext
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
      issueTypes: ['general_support', 'domestic_violence', 'racial_abuse', 'migrant_challenges', 'cyber_scam'],
      regions: ['AU', 'national'],
      availability: 'request_based',
      informationOnly: true
    },
    {
      id: 'multilingual-support',
      advocateType: 'multilingual_support',
      languages: ['en', 'ar', 'es'],
      issueTypes: ['general_support', 'migrant_challenges', 'racial_abuse'],
      regions: ['AU', 'national'],
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
    advocateType: input.advocateType,
    issueType: input.issueType,
    region: input.region,
    safeContactPreference: input.safeContactPreference
  });

  return request;
};

export const createHelpSupportRequest = async (
  context: SupportServiceContext,
  input: HelpSupportRequestInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  const request = await HelpSupportRequestModel.create({
    ...ownerFilter(context.owner),
    title: input.title,
    message: input.message,
    status: 'pending'
  });

  await audit(context, SUPPORT_ACTIONS.helpRequest, request._id.toString(), {
    title: input.title
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
