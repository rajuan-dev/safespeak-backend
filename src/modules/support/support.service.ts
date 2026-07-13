import { StatusCodes } from 'http-status-codes';
import { isValidObjectId, Types, type FilterQuery } from 'mongoose';

import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import {
  LEGACY_ADVOCATE_PROFILES,
  DEFAULT_SUPPORT_SERVICES,
  SUPPORT_ACTIONS,
  type SupportServiceDefinition
} from './support.constants';
import {
  AdvocateProfileModel,
  type AdvocateProfileDocument,
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
  AdminAdvocateProfileQueryInput,
  AdminAdvocateRequestQueryInput,
  AdminWarmReferralQueryInput,
  AdvocateProfileInput,
  AdvocateQueryInput,
  AdvocateRequestInput,
  CancelAdvocateRequestInput,
  HelpSupportRequestInput,
  RecommendationsInput,
  SafetyPlanInput,
  ServicesQueryInput,
  SupportServiceInput,
  UpdateSafetyPlanInput,
  UpdateSupportServiceInput,
  UpdateAdvocateProfileInput,
  UpdateAdvocateRequestInput,
  OwnedAdvocateRequestQueryInput,
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

const assertAdvocateRequestConsent = async (owner: SupportOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.advocate_request) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'advocate_request consent is required');
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
  const filter: FilterQuery<SupportServiceDocument> = { deletedAt: { $exists: false } };

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

export const listSupportServices = async (
  context: SupportServiceContext,
  query: ServicesQueryInput
): Promise<unknown[]> => {
  ownerFilter(context.owner);
  const serviceDocuments = await SupportServiceModel.find(buildPublicServiceFilter(query))
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const services = serviceDocuments.map((service) =>
    toSupportServiceRecord(service as SupportServiceDocument)
  );

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
    isActive: true,
    deletedAt: { $exists: false }
  }).lean();

  if (service) {
    await audit(context, SUPPORT_ACTIONS.serviceGet, undefined, { serviceId });

    return toSupportServiceRecord(service);
  }

  throw new ApiError(StatusCodes.NOT_FOUND, 'Support service not found');
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
  const service = await SupportServiceModel.findOneAndUpdate(
    { _id: serviceId, deletedAt: { $exists: false } },
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
  const service = await SupportServiceModel.findOneAndUpdate(
    { _id: serviceId, deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date(), isPublished: false, isActive: false } },
    { new: true }
  );

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

const publicAdvocateFilter = (
  query: AdvocateQueryInput = {}
): FilterQuery<AdvocateProfileDocument> => {
  const filter: FilterQuery<AdvocateProfileDocument> = {
    deletedAt: { $exists: false },
    isPublished: true,
    isActive: true,
    optInStatus: 'opted_in',
    'vetting.status': 'approved',
    availability: { $ne: 'unavailable' }
  };

  if (query.language) {
    filter.languages = query.language;
  }

  if (query.region) {
    filter.regions = { $in: [query.region, 'national'] };
  }

  if (query.issueType) {
    filter.issueTypes = { $in: [query.issueType, 'general_support'] };
  }

  if (query.culturalProfile) {
    filter.culturalProfiles = query.culturalProfile;
  }

  if (query.faithProfile) {
    filter.faithProfiles = query.faithProfile;
  }

  if (query.availability) {
    filter.availability = query.availability;
  }

  return filter;
};

const toPublicAdvocateRecord = (profile: AdvocateProfileDocument | Record<string, unknown>) => {
  const record =
    typeof (profile as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (profile as { toObject: () => Record<string, unknown> }).toObject()
      : (profile as Record<string, unknown>);
  const key = String(record.key);

  return {
    id: key,
    key,
    advocateType: key,
    displayName: record.displayName,
    description: record.publicBio,
    publicBio: record.publicBio,
    languages: record.languages ?? [],
    issueTypes: record.issueTypes ?? [],
    regions: record.regions ?? [],
    culturalProfiles: record.culturalProfiles ?? [],
    faithProfiles: record.faithProfiles ?? [],
    availability: record.availability,
    informationOnly: true
  };
};

const advocateSnapshot = (profile: AdvocateProfileDocument | Record<string, unknown>) => {
  const publicRecord = toPublicAdvocateRecord(profile);

  return {
    key: publicRecord.key,
    displayName: String(publicRecord.displayName ?? publicRecord.key),
    publicBio: typeof publicRecord.publicBio === 'string' ? publicRecord.publicBio : undefined,
    languages: Array.isArray(publicRecord.languages) ? publicRecord.languages : [],
    issueTypes: Array.isArray(publicRecord.issueTypes) ? publicRecord.issueTypes : [],
    regions: Array.isArray(publicRecord.regions) ? publicRecord.regions : [],
    culturalProfiles: Array.isArray(publicRecord.culturalProfiles)
      ? publicRecord.culturalProfiles
      : [],
    faithProfiles: Array.isArray(publicRecord.faithProfiles) ? publicRecord.faithProfiles : [],
    availability: publicRecord.availability as AdvocateProfileDocument['availability']
  };
};

const getDocumentId = (document: unknown): unknown =>
  (document as { _id?: unknown })._id;

const formatAdvocateRequestReference = (id: unknown): string =>
  `ADV-${String(id).slice(-8).toUpperCase()}`;

const toPublicAdvocateRequestRecord = (request: unknown) => {
  const record =
    typeof (request as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (request as { toObject: () => Record<string, unknown> }).toObject()
      : (request as Record<string, unknown>);

  return {
    _id: record._id,
    id: String(record._id),
    reference: record.reference ?? formatAdvocateRequestReference(record._id),
    advocateType: record.advocateType,
    advocateProfileId: record.advocateProfileId,
    advocateKey: record.advocateKey,
    advocateSnapshot: record.advocateSnapshot,
    language: record.language,
    issueType: record.issueType,
    region: record.region,
    safeContactPreference: record.safeContactPreference,
    confirmationCopy: record.confirmationCopy,
    status: record.status,
    consentSnapshot: record.consentSnapshot,
    statusHistory: Array.isArray(record.statusHistory)
      ? record.statusHistory.map((entry) => ({
          status: entry.status,
          reasonCode: entry.reasonCode,
          createdAt: entry.createdAt
        }))
      : [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
};

const ACTIVE_ADVOCATE_REQUEST_STATUSES = ['pending', 'matched', 'contact_initiated', 'accepted'];
const TERMINAL_ADVOCATE_REQUEST_STATUSES = ['closed', 'declined', 'cancelled', 'completed'];

const assertAdvocateRequestTransition = (
  currentStatus: string,
  nextStatus: string,
  actorType: 'admin' | 'user' | 'anonymous_session'
): void => {
  if (currentStatus === nextStatus) {
    return;
  }

  if (TERMINAL_ADVOCATE_REQUEST_STATUSES.includes(currentStatus)) {
    throw new ApiError(StatusCodes.CONFLICT, 'This advocate request is already closed');
  }

  const adminTransitions: Record<string, string[]> = {
    pending: ['matched', 'declined', 'cancelled'],
    matched: ['contact_initiated', 'declined', 'cancelled'],
    accepted: ['contact_initiated', 'declined', 'cancelled'],
    contact_initiated: ['closed', 'declined'],
    closed: [],
    declined: [],
    cancelled: []
  };
  const userTransitions: Record<string, string[]> = {
    pending: ['cancelled'],
    matched: ['cancelled'],
    accepted: ['cancelled']
  };
  const allowed =
    actorType === 'admin'
      ? adminTransitions[currentStatus] ?? []
      : userTransitions[currentStatus] ?? [];

  if (!allowed.includes(nextStatus)) {
    throw new ApiError(StatusCodes.CONFLICT, 'Invalid advocate request status transition');
  }
};

const ownedAdvocateRequestFilter = (owner: SupportOwner): FilterQuery<Record<string, unknown>> =>
  ownerFilter(owner);

const toOptionalObjectId = (value?: string): Types.ObjectId | undefined =>
  value && isValidObjectId(value) ? (value as unknown as Types.ObjectId) : undefined;

const buildAdvocateFacets = (profiles: Array<Record<string, unknown>>) => {
  const collect = (field: string) =>
    Array.from(
      new Set(
        profiles.flatMap((profile) => {
          const value = profile[field];

          return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
        }) as string[]
      )
    ).sort();

  return {
    languages: collect('languages'),
    regions: collect('regions'),
    issueTypes: collect('issueTypes'),
    culturalProfiles: collect('culturalProfiles'),
    faithProfiles: collect('faithProfiles'),
    availability: Array.from(
      new Set(
        profiles
          .map((profile) => profile.availability)
          .filter((item): item is string => typeof item === 'string')
      )
    ).sort()
  };
};

const findEligibleAdvocate = async (
  input: {
    advocateProfileId?: string;
    advocateKey?: string;
    advocateType?: string;
    language?: string;
    region?: string;
    issueType?: AdvocateQueryInput['issueType'];
  }
): Promise<AdvocateProfileDocument> => {
  const key = (input.advocateKey || input.advocateType || '').replace(/-/g, '_').toLowerCase();
  const filter = publicAdvocateFilter({
    language: input.language,
    region: input.region,
    issueType: input.issueType
  });

  const selector = input.advocateProfileId
    ? { _id: input.advocateProfileId }
    : { key };
  const profile = await AdvocateProfileModel.findOne({ ...filter, ...selector });

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Eligible advocate profile not found');
  }

  return profile;
};

export const listAdvocates = async (
  context: SupportServiceContext,
  query: AdvocateQueryInput = {}
): Promise<{ advocates: unknown[]; facets: Record<string, string[]> }> => {
  ownerFilter(context.owner);
  const profiles = await AdvocateProfileModel.find(publicAdvocateFilter(query))
    .sort({ displayName: 1 })
    .lean();
  const advocates = profiles.map((profile) => toPublicAdvocateRecord(profile));

  await audit(context, SUPPORT_ACTIONS.advocatesList, undefined, { count: advocates.length });

  return {
    advocates,
    facets: buildAdvocateFacets(profiles as Array<Record<string, unknown>>)
  };
};

export const createAdvocateRequest = async (
  context: SupportServiceContext,
  input: AdvocateRequestInput
): Promise<unknown> => {
  ownerFilter(context.owner);
  await assertAdvocateRequestConsent(context.owner);
  const advocate = await findEligibleAdvocate(input);
  const snapshot = advocateSnapshot(advocate);
  const owner = ownerFilter(context.owner);
  const duplicateRequest = await AdvocateRequestModel.findOne({
    ...owner,
    advocateProfileId: getDocumentId(advocate),
    status: { $in: ACTIVE_ADVOCATE_REQUEST_STATUSES }
  })
    .sort({ createdAt: -1 })
    .lean();

  if (duplicateRequest) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'An active advocate request already exists for this advocate',
      [
        {
          code: 'active_advocate_request_exists',
          request: toPublicAdvocateRequestRecord(duplicateRequest)
        }
      ]
    );
  }

  const requestId = new Types.ObjectId();
  const request = await AdvocateRequestModel.create({
    _id: requestId,
    ...owner,
    reference: formatAdvocateRequestReference(requestId),
    ...input,
    advocateType: snapshot.key,
    advocateProfileId: getDocumentId(advocate),
    advocateKey: snapshot.key,
    advocateSnapshot: snapshot,
    consentSnapshot: {
      advocate_request: true,
      capturedAt: new Date()
    },
    statusHistory: [
      {
        status: 'pending',
        actorType: context.owner.userId ? 'user' : 'anonymous_session',
        actorId: toOptionalObjectId(context.owner.userId ?? context.owner.sessionId),
        createdAt: new Date()
      }
    ],
    status: 'pending'
  });

  await audit(context, SUPPORT_ACTIONS.advocateRequest, request._id.toString(), {
    advocateType: input.advocateType,
    issueType: input.issueType,
    region: input.region,
    safeContactPreference: input.safeContactPreference
  });

  return toPublicAdvocateRequestRecord(request);
};

export const listOwnedAdvocateRequests = async (
  context: SupportServiceContext,
  query: OwnedAdvocateRequestQueryInput
): Promise<unknown[]> => {
  const filter: FilterQuery<Record<string, unknown>> = ownedAdvocateRequestFilter(context.owner);

  if (query.status) {
    filter.status = query.status;
  }

  if (query.activeOnly) {
    filter.status = { $in: ACTIVE_ADVOCATE_REQUEST_STATUSES };
  }

  const requests = await AdvocateRequestModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

  await audit(context, SUPPORT_ACTIONS.advocateRequest, undefined, {
    operation: 'list_owned',
    count: requests.length
  });

  return requests.map((request) => toPublicAdvocateRequestRecord(request));
};

export const getOwnedAdvocateRequest = async (
  context: SupportServiceContext,
  requestId: string
): Promise<unknown> => {
  const request = await AdvocateRequestModel.findOne({
    _id: requestId,
    ...ownedAdvocateRequestFilter(context.owner)
  }).lean();

  if (!request) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate request not found');
  }

  return toPublicAdvocateRequestRecord(request);
};

export const cancelOwnedAdvocateRequest = async (
  context: SupportServiceContext,
  requestId: string,
  input: CancelAdvocateRequestInput
): Promise<unknown> => {
  const request = await AdvocateRequestModel.findOne({
    _id: requestId,
    ...ownedAdvocateRequestFilter(context.owner)
  });

  if (!request) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate request not found');
  }

  assertAdvocateRequestTransition(
    request.status,
    'cancelled',
    context.owner.userId ? 'user' : 'anonymous_session'
  );

  const previousStatus = request.status;
  request.status = 'cancelled';
  request.statusHistory = [
    ...(request.statusHistory ?? []),
    {
      previousStatus,
      status: 'cancelled',
      actorType: context.owner.userId ? 'user' : 'anonymous_session',
      actorId: toOptionalObjectId(context.owner.userId ?? context.owner.sessionId),
      reasonCode: input.reasonCode || 'user_cancelled',
      createdAt: new Date()
    }
  ];
  await request.save();

  await audit(context, SUPPORT_ACTIONS.advocateRequest, request._id.toString(), {
    operation: 'cancel_owned',
    previousStatus,
    status: 'cancelled',
    reasonCode: input.reasonCode || 'user_cancelled'
  });

  return toPublicAdvocateRequestRecord(request);
};

const normalizeAdvocateProfileInput = (
  input: AdvocateProfileInput | UpdateAdvocateProfileInput
): Record<string, unknown> => {
  const normalized: Record<string, unknown> = { ...input };

  for (const key of ['publicBio', 'internalContactReference', 'privateEmail', 'privatePhone'] as const) {
    if (normalized[key] === '') {
      delete normalized[key];
    }
  }

  if (normalized.vetting && typeof normalized.vetting === 'object') {
    const vetting = normalized.vetting as Record<string, unknown>;

    if (vetting.notes === '') {
      delete vetting.notes;
    }

    normalized.vetting = vetting;
  }

  return normalized;
};

const assertAdvocateCanBePublished = (
  nextProfile: Partial<AdvocateProfileDocument> & {
    vetting?: Partial<AdvocateProfileDocument['vetting']>;
  }
): void => {
  if (!nextProfile.isPublished) {
    return;
  }

  if (!nextProfile.isActive) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only active advocates can be published');
  }

  if (nextProfile.optInStatus !== 'opted_in') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only opted-in advocates can be published');
  }

  if (nextProfile.vetting?.status !== 'approved') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only approved advocates can be published');
  }

  if (nextProfile.availability === 'unavailable') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unavailable advocates cannot be published');
  }
};

const toAdminAdvocateProfileRecord = (
  profile: AdvocateProfileDocument | Record<string, unknown>
) => {
  const record =
    typeof (profile as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (profile as { toObject: () => Record<string, unknown> }).toObject()
      : (profile as Record<string, unknown>);

  return {
    ...record,
    hasPrivateEmail: typeof record.privateEmail === 'string' && record.privateEmail.length > 0,
    hasPrivatePhone: typeof record.privatePhone === 'string' && record.privatePhone.length > 0,
    privateEmail: undefined,
    privatePhone: undefined
  };
};

const buildAdminAdvocateFilter = (
  query: AdminAdvocateProfileQueryInput
): FilterQuery<AdvocateProfileDocument> => {
  const filter: FilterQuery<AdvocateProfileDocument> = publicAdvocateFilter(query);
  delete filter.isPublished;
  delete filter.isActive;
  delete filter.optInStatus;
  delete filter['vetting.status'];
  delete filter.availability;

  if (query.includeDeleted) {
    delete filter.deletedAt;
  }

  if (query.isPublished !== undefined) {
    filter.isPublished = query.isPublished;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive;
  }

  if (query.vettingStatus) {
    filter['vetting.status'] = query.vettingStatus;
  }

  if (query.optInStatus) {
    filter.optInStatus = query.optInStatus;
  }

  if (query.availability) {
    filter.availability = query.availability;
  }

  return filter;
};

export const listAdminAdvocateProfiles = async (
  context: AdminSupportServiceContext,
  query: AdminAdvocateProfileQueryInput
): Promise<unknown[]> => {
  const profiles = await AdvocateProfileModel.find(buildAdminAdvocateFilter(query))
    .sort({ displayName: 1 })
    .lean();

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateProfilesList, undefined, {
    count: profiles.length
  });

  return profiles.map((profile) => toAdminAdvocateProfileRecord(profile));
};

export const createAdvocateProfile = async (
  context: AdminSupportServiceContext,
  input: AdvocateProfileInput
): Promise<unknown> => {
  const existing = await AdvocateProfileModel.findOne({
    key: input.key,
    deletedAt: { $exists: false }
  });

  if (existing) {
    throw new ApiError(StatusCodes.CONFLICT, 'Advocate profile key already exists');
  }

  const normalized = normalizeAdvocateProfileInput(input);
  assertAdvocateCanBePublished(normalized as Partial<AdvocateProfileDocument>);

  const profile = await AdvocateProfileModel.create({
    ...normalized,
    createdBy: context.adminUserId,
    updatedBy: context.adminUserId
  });

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateProfileCreate, profile._id.toString(), {
    key: profile.key,
    isPublished: profile.isPublished,
    vettingStatus: profile.vetting.status,
    optInStatus: profile.optInStatus
  });

  return toAdminAdvocateProfileRecord(profile);
};

export const updateAdvocateProfile = async (
  context: AdminSupportServiceContext,
  profileId: string,
  input: UpdateAdvocateProfileInput
): Promise<unknown> => {
  const existing = await AdvocateProfileModel.findOne({
    _id: profileId,
    deletedAt: { $exists: false }
  });

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate profile not found');
  }

  const normalized = normalizeAdvocateProfileInput(input);
  assertAdvocateCanBePublished({
    ...existing.toObject(),
    ...normalized,
    vetting: {
      ...existing.vetting,
      ...((normalized.vetting as Partial<AdvocateProfileDocument['vetting']> | undefined) ?? {})
    }
  } as Partial<AdvocateProfileDocument>);

  const profile = await AdvocateProfileModel.findOneAndUpdate(
    { _id: profileId, deletedAt: { $exists: false } },
    { $set: { ...normalized, updatedBy: context.adminUserId } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate profile not found');
  }

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateProfileUpdate, profile._id.toString(), {
    changedFields: Object.keys(input),
    key: profile.key,
    isPublished: profile.isPublished,
    vettingStatus: profile.vetting.status,
    optInStatus: profile.optInStatus
  });

  return toAdminAdvocateProfileRecord(profile);
};

export const getAdvocateProfileDependencies = async (
  context: AdminSupportServiceContext,
  profileId: string
): Promise<unknown> => {
  const profile = await AdvocateProfileModel.findById(profileId).lean();

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate profile not found');
  }

  const activeRequestCount = await AdvocateRequestModel.countDocuments({
    $or: [{ advocateProfileId: profileId }, { assignedAdvocateProfileId: profileId }],
    status: { $in: ['pending', 'matched', 'contact_initiated', 'accepted'] }
  });
  const historicalRequestCount = await AdvocateRequestModel.countDocuments({
    $or: [{ advocateProfileId: profileId }, { assignedAdvocateProfileId: profileId }]
  });

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateProfileDependencies, profileId, {
    activeRequestCount,
    historicalRequestCount
  });

  return {
    profileId,
    key: profile.key,
    hasBlockingDependencies: activeRequestCount > 0,
    hasHistoricalDependencies: historicalRequestCount > 0,
    activeRequestCount,
    historicalRequestCount,
    warning:
      activeRequestCount > 0
        ? 'This advocate has active requests. Delete is blocked; deactivate instead.'
        : 'Delete is a soft delete and keeps historical request records intact.'
  };
};

export const deleteAdvocateProfile = async (
  context: AdminSupportServiceContext,
  profileId: string
): Promise<void> => {
  const dependencies = (await getAdvocateProfileDependencies(context, profileId)) as {
    hasBlockingDependencies: boolean;
  };

  if (dependencies.hasBlockingDependencies) {
    throw new ApiError(StatusCodes.CONFLICT, 'Advocate profile has active request dependencies');
  }

  const profile = await AdvocateProfileModel.findOneAndUpdate(
    { _id: profileId, deletedAt: { $exists: false } },
    {
      $set: {
        deletedAt: new Date(),
        isPublished: false,
        isActive: false,
        updatedBy: context.adminUserId
      }
    },
    { new: true }
  );

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate profile not found');
  }

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateProfileDelete, profile._id.toString(), {
    key: profile.key
  });
};

export const listAdminAdvocateRequests = async (
  context: AdminSupportServiceContext,
  query: AdminAdvocateRequestQueryInput
): Promise<unknown[]> => {
  const filter: FilterQuery<Record<string, unknown>> = {};

  if (query.status) {
    filter.status = query.status;
  }

  if (query.advocateProfileId) {
    filter.advocateProfileId = query.advocateProfileId;
  }

  if (query.advocateKey) {
    filter.advocateKey = query.advocateKey;
  }

  const requests = await AdvocateRequestModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateRequestsList, undefined, {
    count: requests.length,
    status: query.status
  });

  return requests;
};

export const updateAdvocateRequest = async (
  context: AdminSupportServiceContext,
  requestId: string,
  input: UpdateAdvocateRequestInput
): Promise<unknown> => {
  const updates: Record<string, unknown> = {};
  const existing = await AdvocateRequestModel.findById(requestId);

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate request not found');
  }

  if (input.status) {
    assertAdvocateRequestTransition(existing.status, input.status, 'admin');
    updates.status = input.status;
  }

  if (input.assignedAdvocateProfileId) {
    const advocate = await findEligibleAdvocate({
      advocateProfileId: input.assignedAdvocateProfileId
    });
    updates.assignedAdvocateProfileId = getDocumentId(advocate);
    updates.assignedAdvocateKey = advocate.key;
    updates.assignedAdvocateSnapshot = advocateSnapshot(advocate);
    updates.assignedAt = new Date();
    updates.assignedBy = context.adminUserId;

    if (!input.status) {
      assertAdvocateRequestTransition(existing.status, 'matched', 'admin');
      updates.status = 'matched';
    }
  }

  const nextStatus = (updates.status as string | undefined) ?? existing.status;
  const historyUpdate =
    nextStatus !== existing.status
      ? {
          statusHistory: {
            previousStatus: existing.status,
            status: nextStatus,
            actorType: 'admin',
            actorId: context.adminUserId,
            reasonCode: input.reasonCode || undefined,
            createdAt: new Date()
          }
        }
      : undefined;

  const pushUpdate =
    input.note && input.note.trim()
      ? {
          adminNotes: {
            note: input.note.trim(),
            createdAt: new Date(),
            createdBy: context.adminUserId
          }
        }
      : undefined;

  const request = await AdvocateRequestModel.findByIdAndUpdate(
    requestId,
    {
      ...(Object.keys(updates).length ? { $set: updates } : {}),
      ...(pushUpdate || historyUpdate
        ? {
            $push: {
              ...(pushUpdate ?? {}),
              ...(historyUpdate ?? {})
            }
          }
        : {})
    },
    { new: true, runValidators: true }
  );

  if (!request) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advocate request not found');
  }

  await auditAdmin(context, SUPPORT_ACTIONS.adminAdvocateRequestUpdate, request._id.toString(), {
    status: input.status,
    assignedAdvocateProfileId: input.assignedAdvocateProfileId,
    noteAdded: Boolean(input.note)
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

const supportServiceSeedInput = (service: SupportServiceDefinition): Record<string, unknown> => ({
  ...service,
  key: service.key ?? service.id,
  websiteUrl: service.websiteUrl ?? service.url,
  isPublished: service.isPublished ?? true,
  isActive: service.isActive ?? true,
  sortOrder: service.sortOrder ?? service.priority ?? 50
});

export const seedDefaultSupportData = async (): Promise<void> => {
  await Promise.all(
    DEFAULT_SUPPORT_SERVICES.map(async (service) => {
      const key = service.key ?? service.id;

      await SupportServiceModel.updateOne(
        { key },
        { $setOnInsert: supportServiceSeedInput(service) },
        { upsert: true, runValidators: true }
      );
    })
  );

  await Promise.all(
    LEGACY_ADVOCATE_PROFILES.map(async (profile) => {
      await AdvocateProfileModel.updateOne(
        { key: profile.key },
        {
          $setOnInsert: {
            ...profile,
            vetting: { status: profile.vettingStatus },
            trainingCredentials: profile.trainingCredentials ?? []
          }
        },
        { upsert: true, runValidators: true }
      );
    })
  );
};
