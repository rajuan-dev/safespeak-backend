import { env } from '@config/env';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

import {
  adminNotificationsQuerySchema,
  adminParamsSchema,
  auditLogsQuerySchema,
  createAdminUserSchema,
  culturalProfileQuerySchema,
  culturalProfileSchema,
  destinationQuerySchema,
  destinationSchema,
  markAdminNotificationReadSchema,
  markAdminNotificationsReadSchema,
  privacyRequestQuerySchema,
  reportDeliveryQuerySchema,
  submissionTemplateQuerySchema,
  submissionTemplateSchema,
  taxonomyQuerySchema,
  taxonomySchema,
  updateAdminUserSchema,
  updateCulturalProfileSchema,
  updateDestinationSchema,
  updatePrivacyRequestSchema,
  updateSubmissionTemplateSchema,
  updateTaxonomySchema,
  usersQuerySchema
} from '@modules/admin/admin.schema';
import {
  clarifyingQuestionsSchema,
  extractIncidentFieldsSchema,
  generateSummarySchema,
  redactPiiSchema,
  synthesizeSpeechSchema,
  transcribeAudioBodySchema,
  translateSchema,
  triageReportSchema
} from '@modules/ai/ai.schema';
import {
  analyticsExportQuerySchema,
  analyticsQuerySchema,
  localIntelligenceQuerySchema
} from '@modules/analytics/analytics.schema';
import {
  changePasswordSchema,
  deactivateAccountSchema as authDeactivateAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema as authRegisterSchema,
  resetPasswordSchema,
  updateCurrentUserProfileSchema,
  verifyPasswordResetOtpSchema
} from '@modules/auth/auth.schema';
import { updateConsentSchema, withdrawConsentSchema } from '@modules/consent/consent.schema';
import {
  contentPageParamsSchema,
  contentPagePublishSchema,
  contentPageUpdateSchema
} from '@modules/content-pages/content-pages.schema';
import {
  contentResourceParamsSchema,
  contentResourceQuerySchema,
  createContentResourceSchema,
  updateContentResourceSchema
} from '@modules/content-resources/content-resources.schema';
import {
  appendConversationFlowMessageSchema,
  conversationFlowSessionParamsSchema,
  createConversationFlowSessionSchema
} from '@modules/conversation-flow/conversation-flow.schema';
import {
  completeUploadBodySchema,
  createUploadUrlSchema,
  evidenceParamsSchema,
  reportEvidenceParamsSchema,
  transcribeEvidenceBodySchema,
  verifyHashBodySchema
} from '@modules/evidence/evidence.schema';
import {
  adminFeedbackQuerySchema,
  feedbackParamsSchema,
  feedbackSubmissionSchema,
  updateAdminFeedbackSchema
} from '@modules/feedback/feedback.schema';
import {
  createMediaAssetSchema,
  mediaAssetParamsSchema,
  mediaAssetQuerySchema,
  updateMediaAssetSchema
} from '@modules/media-assets/media-assets.schema';
import {
  createMicroEducationSchema,
  microEducationAdminQuerySchema,
  microEducationParamsSchema,
  updateMicroEducationSchema
} from '@modules/microeducation/microeducation.schema';
import {
  markUserNotificationReadSchema,
  markUserNotificationsReadSchema,
  userNotificationsQuerySchema
} from '@modules/notifications/notifications.schema';
import { updatePlatformSettingsDraftSchema } from '@modules/platform-settings/platform-settings.schema';
import { createPrivacyRequestSchema, deleteRequestSchema, privacyRequestParamsSchema } from '@modules/privacy/privacy.schema';
import { updateProfileSchema } from '@modules/profile/profile.schema';
import {
  acknowledgeSubmissionSchema,
  createReportSchema,
  reportDestinationPreviewQuerySchema,
  reportParamsSchema,
  submissionParamsSchema,
  submissionPreviewSchema,
  submitReportSchema,
  updateReportSchema
} from '@modules/reports/reports.schema';
import {
  createResourceSchema,
  resourceAdminQuerySchema,
  resourceParamsSchema,
  updateResourceSchema
} from '@modules/resources/resources.schema';
import {
  analyzeEmailSchema,
  analyzeScreenshotSchema,
  analyzeTextSchema,
  checkUrlSchema,
  generateReportDraftByIdSchema,
  generateReportDraftSchema,
  redactScamContentSchema,
  scamShieldParamsSchema,
  submitScamReportByIdSchema,
  submitScamReportSchema
} from '@modules/scamshield/scamshield.schema';
import { createAnonymousSessionSchema, convertToUserSchema } from '@modules/sessions/sessions.schema';
import {
  adminServicesQuerySchema,
  adminSupportServiceParamsSchema,
  adminWarmReferralQuerySchema,
  advocateRequestSchema,
  helpSupportRequestSchema,
  recommendationsSchema,
  safetyPlanParamsSchema,
  safetyPlanSchema,
  serviceParamsSchema,
  servicesQuerySchema,
  supportServiceSchema,
  updateSafetyPlanSchema,
  updateSupportServiceSchema,
  updateWarmReferralStatusSchema,
  warmReferralSchema
} from '@modules/support/support.schema';
import { SAFE_SPEAK_SESSION_HEADER } from '@modules/sessions/sessions.constants';

type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';
type SecurityMode = 'public' | 'bearer' | 'sessionOrUser';
type ResponseKind = 'json' | 'binary' | 'redirect';

type MultipartFileField = {
  name: string;
  isArray?: boolean;
  description?: string;
};

type RouteDoc = {
  method: HttpMethod;
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  security?: SecurityMode;
  paramsSchema?: z.ZodTypeAny;
  querySchema?: z.ZodTypeAny;
  bodySchema?: z.ZodTypeAny;
  requestContentType?: 'application/json' | 'multipart/form-data';
  multipartFiles?: MultipartFileField[];
  successStatus?: number;
  responseKind?: ResponseKind;
  responseContentType?: string;
  deprecated?: boolean;
};

const componentSchemas = new Map<string, Record<string, unknown>>();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const extractJsonSchema = (name: string, schema: z.ZodTypeAny): Record<string, unknown> => {
  const result = zodToJsonSchema(schema, {
    name,
    target: 'openApi3',
    $refStrategy: 'none'
  }) as {
    definitions?: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
  const definition = clone(result.definitions?.[name] ?? result);
  delete definition.$schema;
  return definition;
};

const registerSchema = (name: string, schema: z.ZodTypeAny): string => {
  if (!componentSchemas.has(name)) {
    componentSchemas.set(name, extractJsonSchema(name, schema));
  }

  return `#/components/schemas/${name}`;
};

const registerSyntheticSchema = (name: string, schema: Record<string, unknown>): string => {
  if (!componentSchemas.has(name)) {
    componentSchemas.set(name, clone(schema));
  }

  return `#/components/schemas/${name}`;
};

const getSchemaObject = (name: string, schema: z.ZodTypeAny): Record<string, unknown> => {
  const schemaRef = registerSchema(name, schema);
  const componentName = schemaRef.split('/').pop() as string;
  return componentSchemas.get(componentName) as Record<string, unknown>;
};

const buildParameters = (
  schemaName: string,
  schema: z.ZodTypeAny,
  location: 'path' | 'query'
): Record<string, unknown>[] => {
  const schemaObject = getSchemaObject(schemaName, schema);
  const properties = (schemaObject.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(((schemaObject.required ?? []) as string[]));

  return Object.entries(properties).map(([name, value]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.has(name),
    schema: value,
    description: typeof value.description === 'string' ? value.description : undefined
  }));
};

const buildRequestBody = (route: RouteDoc): Record<string, unknown> | undefined => {
  if (!route.bodySchema) {
    return undefined;
  }

  if (route.requestContentType === 'multipart/form-data') {
    const schemaObject = clone(getSchemaObject(`${route.operationId}Body`, route.bodySchema));
    const properties = ((schemaObject.properties ?? {}) as Record<string, unknown>);

    for (const fileField of route.multipartFiles ?? []) {
      properties[fileField.name] = fileField.isArray
        ? {
            type: 'array',
            items: {
              type: 'string',
              format: 'binary'
            },
            description: fileField.description
          }
        : {
            type: 'string',
            format: 'binary',
            description: fileField.description
          };
    }

    schemaObject.type = 'object';
    schemaObject.properties = properties;

    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: schemaObject
        }
      }
    };
  }

  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          $ref: registerSchema(`${route.operationId}Body`, route.bodySchema)
        }
      }
    }
  };
};

const successEnvelopeRef = registerSyntheticSchema('SuccessEnvelope', {
  type: 'object',
  required: ['success', 'message', 'data', 'meta', 'timestamp'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    message: { type: 'string' },
    data: {
      nullable: true,
      oneOf: [
        { type: 'object', additionalProperties: true },
        { type: 'array', items: { type: 'object', additionalProperties: true } }
      ]
    },
    meta: {
      type: 'object',
      nullable: true,
      additionalProperties: true
    },
    timestamp: { type: 'string', format: 'date-time' }
  }
});

const errorEnvelopeRef = registerSyntheticSchema('ErrorEnvelope', {
  type: 'object',
  required: ['success', 'message', 'data', 'meta', 'timestamp'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    message: { type: 'string' },
    data: { type: 'null', nullable: true },
    meta: { type: 'object', nullable: true, additionalProperties: true },
    errors: {
      type: 'array',
      items: { type: 'object', additionalProperties: true }
    },
    errorCode: { type: 'string' },
    requestId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' }
  }
});

const defaultJsonResponses = (
  successStatus: number,
  successDescription: string,
  security: SecurityMode
): Record<string, unknown> => {
  const responses: Record<string, unknown> = {
    [String(successStatus)]: {
      description: successDescription,
      content: {
        'application/json': {
          schema: { $ref: successEnvelopeRef }
        }
      }
    },
    '400': {
      description: 'Validation failed',
      content: {
        'application/json': {
          schema: { $ref: errorEnvelopeRef }
        }
      }
    },
    '500': {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: { $ref: errorEnvelopeRef }
        }
      }
    }
  };

  if (security !== 'public') {
    responses['401'] = {
      description: 'Authentication required or invalid credentials',
      content: {
        'application/json': {
          schema: { $ref: errorEnvelopeRef }
        }
      }
    };
  }

  if (security === 'bearer') {
    responses['403'] = {
      description: 'Insufficient permissions',
      content: {
        'application/json': {
          schema: { $ref: errorEnvelopeRef }
        }
      }
    };
  }

  return responses;
};

const buildResponses = (route: RouteDoc): Record<string, unknown> => {
  const successStatus = route.successStatus ?? (route.method === 'post' ? 201 : 200);

  if (route.responseKind === 'redirect') {
    return {
      [String(successStatus)]: {
        description: 'Redirects the client to the OAuth provider or frontend callback URL'
      },
      '503': {
        description: 'OAuth provider is not configured',
        content: {
          'application/json': {
            schema: { $ref: errorEnvelopeRef }
          }
        }
      }
    };
  }

  if (route.responseKind === 'binary') {
    return {
      [String(successStatus)]: {
        description: route.summary,
        content: {
          [route.responseContentType ?? 'application/octet-stream']: {
            schema: {
              type: 'string',
              format: 'binary'
            }
          }
        }
      },
      ...defaultJsonResponses(400, route.summary, route.security ?? 'public')
    };
  }

  return defaultJsonResponses(successStatus, route.summary, route.security ?? 'public');
};

const getSecurity = (security: SecurityMode | undefined): Record<string, unknown>[] | undefined => {
  if (!security || security === 'public') {
    return undefined;
  }

  if (security === 'sessionOrUser') {
    return [{ bearerAuth: [] }, { anonymousSessionAuth: [] }];
  }

  return [{ bearerAuth: [] }];
};

const withBase = (
  basePath: string,
  tag: string,
  security: SecurityMode,
  routes: Omit<RouteDoc, 'tag' | 'security'>[]
): RouteDoc[] =>
  routes.map((route) => ({
    ...route,
    path: `${basePath}${route.path}`,
    tag,
    security
  }));

const routeDocs: RouteDoc[] = [
  {
    method: 'get',
    path: '/health',
    operationId: 'getHealth',
    tag: 'Health',
    summary: 'Get service health status',
    security: 'public'
  },
  {
    method: 'get',
    path: '/api/v1/health',
    operationId: 'getVersionedHealth',
    tag: 'Health',
    summary: 'Get service health status (versioned)',
    security: 'public'
  },
  {
    method: 'get',
    path: '/api/auth/google',
    operationId: 'startGoogleAuthLegacy',
    tag: 'Auth',
    summary: 'Start Google OAuth login flow (legacy path)',
    responseKind: 'redirect',
    successStatus: 302,
    security: 'public',
    deprecated: true
  },
  {
    method: 'get',
    path: '/api/auth/google/callback',
    operationId: 'handleGoogleAuthCallbackLegacy',
    tag: 'Auth',
    summary: 'Handle Google OAuth callback (legacy path)',
    responseKind: 'redirect',
    successStatus: 302,
    security: 'public',
    deprecated: true
  },
  ...withBase('/api/v1/auth', 'Auth', 'public', [
    {
      method: 'get',
      path: '/google',
      operationId: 'startGoogleAuth',
      summary: 'Start Google OAuth login flow',
      responseKind: 'redirect',
      successStatus: 302
    },
    {
      method: 'get',
      path: '/google/callback',
      operationId: 'handleGoogleAuthCallback',
      summary: 'Handle Google OAuth callback',
      responseKind: 'redirect',
      successStatus: 302
    },
    {
      method: 'post',
      path: '/register',
      operationId: 'registerUser',
      summary: 'Register a user account',
      bodySchema: authRegisterSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/login',
      operationId: 'loginUser',
      summary: 'Log in a user',
      bodySchema: loginSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/admin/login',
      operationId: 'loginAdmin',
      summary: 'Log in an admin user',
      bodySchema: loginSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/refresh',
      operationId: 'refreshAuthToken',
      summary: 'Refresh an access token',
      bodySchema: refreshTokenSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/forgot-password',
      operationId: 'requestPasswordReset',
      summary: 'Request a password reset code',
      bodySchema: forgotPasswordSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/verify-reset-otp',
      operationId: 'verifyResetOtp',
      summary: 'Verify a password reset OTP',
      bodySchema: verifyPasswordResetOtpSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/reset-password',
      operationId: 'resetPassword',
      summary: 'Reset a password after OTP verification',
      bodySchema: resetPasswordSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/auth', 'Auth', 'bearer', [
    {
      method: 'post',
      path: '/logout',
      operationId: 'logoutUser',
      summary: 'Log out the current user',
      successStatus: 200
    },
    {
      method: 'post',
      path: '/change-password',
      operationId: 'changePassword',
      summary: 'Change the current user password',
      bodySchema: changePasswordSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/me',
      operationId: 'getCurrentUser',
      summary: 'Get the current authenticated user',
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/me',
      operationId: 'updateCurrentUser',
      summary: 'Update the current authenticated user',
      bodySchema: updateCurrentUserProfileSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/deactivate',
      operationId: 'deactivateCurrentUser',
      summary: 'Deactivate the current authenticated user account',
      bodySchema: authDeactivateAccountSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/sessions', 'Sessions', 'public', [
    {
      method: 'post',
      path: '/anonymous',
      operationId: 'createAnonymousSession',
      summary: 'Create an anonymous SafeSpeak session',
      bodySchema: createAnonymousSessionSchema,
      successStatus: 201
    }
  ]),
  ...withBase('/api/v1/sessions', 'Sessions', 'sessionOrUser', [
    {
      method: 'get',
      path: '/current',
      operationId: 'getCurrentSession',
      summary: 'Get the current anonymous session or authenticated user session',
      successStatus: 200
    },
    {
      method: 'post',
      path: '/convert-to-user',
      operationId: 'convertAnonymousSessionToUser',
      summary: 'Convert an anonymous session into a registered user',
      bodySchema: convertToUserSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/consents', 'Consents', 'sessionOrUser', [
    {
      method: 'get',
      path: '/current',
      operationId: 'getCurrentConsent',
      summary: 'Get the current consent state',
      successStatus: 200
    },
    {
      method: 'post',
      path: '/update',
      operationId: 'updateConsent',
      summary: 'Update consent settings',
      bodySchema: updateConsentSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/withdraw',
      operationId: 'withdrawConsent',
      summary: 'Withdraw previously granted consent',
      bodySchema: withdrawConsentSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/history',
      operationId: 'getConsentHistory',
      summary: 'Get consent history',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/conversation-flow', 'Conversation Flow', 'sessionOrUser', [
    {
      method: 'post',
      path: '/sessions',
      operationId: 'createConversationSession',
      summary: 'Create a structured conversation session',
      bodySchema: createConversationFlowSessionSchema,
      successStatus: 201
    },
    {
      method: 'get',
      path: '/sessions/{id}',
      operationId: 'getConversationSession',
      summary: 'Get a conversation session',
      paramsSchema: conversationFlowSessionParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/sessions/{id}/messages',
      operationId: 'appendConversationMessage',
      summary: 'Append a message to a conversation session',
      paramsSchema: conversationFlowSessionParamsSchema,
      bodySchema: appendConversationFlowMessageSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/sessions/{id}/triage',
      operationId: 'getConversationTriage',
      summary: 'Get conversation triage results',
      paramsSchema: conversationFlowSessionParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/sessions/{id}/support',
      operationId: 'getConversationSupport',
      summary: 'Get support bundle for a conversation session',
      paramsSchema: conversationFlowSessionParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/sessions/{id}/recommendations',
      operationId: 'getConversationRecommendations',
      summary: 'Get recommendations for a conversation session',
      paramsSchema: conversationFlowSessionParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/sessions/{id}/details',
      operationId: 'getConversationDetails',
      summary: 'Get detailed structured output for a conversation session',
      paramsSchema: conversationFlowSessionParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1', 'Profile', 'public', [
    {
      method: 'get',
      path: '/languages',
      operationId: 'listLanguages',
      summary: 'List supported languages',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/cultural-profiles',
      operationId: 'listCulturalProfiles',
      summary: 'List public cultural profiles',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/faith-profiles',
      operationId: 'listFaithProfiles',
      summary: 'List public faith profiles',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/community-profiles',
      operationId: 'listCommunityProfiles',
      summary: 'List public community profiles',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1', 'Profile', 'sessionOrUser', [
    {
      method: 'get',
      path: '/profile',
      operationId: 'getProfile',
      summary: 'Get the current profile',
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/profile',
      operationId: 'updateProfile',
      summary: 'Update the current profile',
      bodySchema: updateProfileSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/platform-settings', 'Platform Settings', 'public', [
    {
      method: 'get',
      path: '/',
      operationId: 'getPublicPlatformSettings',
      summary: 'Get public platform settings',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/platform-settings', 'Admin Platform Settings', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'getAdminPlatformSettings',
      summary: 'Get admin platform settings draft and published values',
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/draft',
      operationId: 'updateAdminPlatformSettingsDraft',
      summary: 'Update platform settings draft',
      bodySchema: updatePlatformSettingsDraftSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/publish',
      operationId: 'publishAdminPlatformSettingsDraft',
      summary: 'Publish the current platform settings draft',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/microeducation', 'Microeducation', 'public', [
    {
      method: 'get',
      path: '/',
      operationId: 'listPublicMicroeducation',
      summary: 'List public microeducation items',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/image',
      operationId: 'getPublicMicroeducationImage',
      summary: 'Get the image for a microeducation item',
      paramsSchema: microEducationParamsSchema,
      responseKind: 'binary',
      responseContentType: 'image/*',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/microeducation', 'Admin Microeducation', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listAdminMicroeducation',
      summary: 'List microeducation items for admins',
      querySchema: microEducationAdminQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/',
      operationId: 'createAdminMicroeducation',
      summary: 'Create a microeducation item',
      bodySchema: createMicroEducationSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [{ name: 'image', description: 'Microeducation image file' }],
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateAdminMicroeducation',
      summary: 'Update a microeducation item',
      paramsSchema: microEducationParamsSchema,
      bodySchema: updateMicroEducationSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [{ name: 'image', description: 'Replacement microeducation image file' }],
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/{id}',
      operationId: 'deleteAdminMicroeducation',
      summary: 'Delete a microeducation item',
      paramsSchema: microEducationParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/content-pages', 'Content Pages', 'public', [
    {
      method: 'get',
      path: '/{key}',
      operationId: 'getPublicContentPage',
      summary: 'Get a public content page by key',
      paramsSchema: contentPageParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/content-pages', 'Admin Content Pages', 'bearer', [
    {
      method: 'get',
      path: '/{key}',
      operationId: 'getAdminContentPage',
      summary: 'Get a content page draft by key',
      paramsSchema: contentPageParamsSchema,
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/{key}',
      operationId: 'saveAdminContentPage',
      summary: 'Save a content page draft',
      paramsSchema: contentPageParamsSchema,
      bodySchema: contentPageUpdateSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{key}/publish',
      operationId: 'publishAdminContentPage',
      summary: 'Publish a content page draft',
      paramsSchema: contentPageParamsSchema,
      bodySchema: contentPagePublishSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/content-resources', 'Content Resources', 'public', [
    {
      method: 'get',
      path: '/',
      operationId: 'listPublicContentResources',
      summary: 'List public content resources',
      querySchema: contentResourceQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/download',
      operationId: 'downloadPublicContentResource',
      summary: 'Download a content resource file',
      paramsSchema: contentResourceParamsSchema,
      responseKind: 'binary',
      responseContentType: 'application/octet-stream',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/image',
      operationId: 'getPublicContentResourceImage',
      summary: 'Get a content resource preview image',
      paramsSchema: contentResourceParamsSchema,
      responseKind: 'binary',
      responseContentType: 'image/*',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/content-resources', 'Admin Content Resources', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listAdminContentResources',
      summary: 'List content resources for admins',
      querySchema: contentResourceQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}',
      operationId: 'getAdminContentResource',
      summary: 'Get an admin content resource detail',
      paramsSchema: contentResourceParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/',
      operationId: 'createAdminContentResource',
      summary: 'Create a content resource',
      bodySchema: createContentResourceSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [
        { name: 'file', description: 'Primary content resource file' },
        { name: 'image', description: 'Preview image file' }
      ],
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateAdminContentResource',
      summary: 'Update a content resource',
      paramsSchema: contentResourceParamsSchema,
      bodySchema: updateContentResourceSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [
        { name: 'file', description: 'Replacement content resource file' },
        { name: 'image', description: 'Replacement preview image file' }
      ],
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/{id}',
      operationId: 'deleteAdminContentResource',
      summary: 'Delete a content resource',
      paramsSchema: contentResourceParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/media-assets', 'Media Assets', 'public', [
    {
      method: 'get',
      path: '/',
      operationId: 'listPublicMediaAssets',
      summary: 'List public media assets',
      querySchema: mediaAssetQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/file',
      operationId: 'getPublicMediaAssetFile',
      summary: 'Get the file for a media asset',
      paramsSchema: mediaAssetParamsSchema,
      responseKind: 'binary',
      responseContentType: 'application/octet-stream',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/media-assets', 'Admin Media Assets', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listAdminMediaAssets',
      summary: 'List media assets for admins',
      querySchema: mediaAssetQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}',
      operationId: 'getAdminMediaAsset',
      summary: 'Get an admin media asset detail',
      paramsSchema: mediaAssetParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/',
      operationId: 'createAdminMediaAsset',
      summary: 'Create a media asset',
      bodySchema: createMediaAssetSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [{ name: 'file', description: 'Media asset file' }],
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateAdminMediaAsset',
      summary: 'Update a media asset',
      paramsSchema: mediaAssetParamsSchema,
      bodySchema: updateMediaAssetSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [{ name: 'file', description: 'Replacement media asset file' }],
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/{id}',
      operationId: 'deleteAdminMediaAsset',
      summary: 'Delete a media asset',
      paramsSchema: mediaAssetParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/resources', 'Resources', 'public', [
    {
      method: 'get',
      path: '/',
      operationId: 'listPublicResources',
      summary: 'List public resource cards',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/resources', 'Admin Resources', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listAdminResources',
      summary: 'List resources for admins',
      querySchema: resourceAdminQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/',
      operationId: 'createAdminResource',
      summary: 'Create a resource',
      bodySchema: createResourceSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateAdminResource',
      summary: 'Update a resource',
      paramsSchema: resourceParamsSchema,
      bodySchema: updateResourceSchema,
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/{id}',
      operationId: 'deleteAdminResource',
      summary: 'Delete a resource',
      paramsSchema: resourceParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/reports', 'Reports', 'sessionOrUser', [
    {
      method: 'post',
      path: '/',
      operationId: 'createReport',
      summary: 'Create a report draft',
      bodySchema: createReportSchema,
      successStatus: 201
    },
    {
      method: 'get',
      path: '/',
      operationId: 'listReports',
      summary: 'List reports for the current owner',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}',
      operationId: 'getReport',
      summary: 'Get a report by id',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateReport',
      summary: 'Update a report draft',
      paramsSchema: reportParamsSchema,
      bodySchema: updateReportSchema,
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/{id}',
      operationId: 'deleteReport',
      summary: 'Delete a report draft',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/mark-info-only',
      operationId: 'markReportInfoOnly',
      summary: 'Mark a report as information-only',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/withdraw',
      operationId: 'withdrawReport',
      summary: 'Withdraw a report',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/request-delete',
      operationId: 'requestReportDeletion',
      summary: 'Request deletion of a report',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/status',
      operationId: 'getReportStatus',
      summary: 'Get report submission status',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/timeline',
      operationId: 'getReportTimeline',
      summary: 'Get report event timeline',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/destinations',
      operationId: 'getReportDestinationPreviews',
      summary: 'Get destination previews for a report',
      paramsSchema: reportParamsSchema,
      querySchema: reportDestinationPreviewQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}/submissions',
      operationId: 'listReportSubmissions',
      summary: 'List submissions created for a report',
      paramsSchema: reportParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/submission-previews',
      operationId: 'previewReportSubmissionPayloads',
      summary: 'Generate report submission payload previews',
      paramsSchema: reportParamsSchema,
      bodySchema: submissionPreviewSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/submissions',
      operationId: 'submitReport',
      summary: 'Submit a report to a destination',
      paramsSchema: reportParamsSchema,
      bodySchema: submitReportSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/{id}/submissions/{submissionId}/acknowledge',
      operationId: 'acknowledgeReportSubmission',
      summary: 'Acknowledge a report submission delivery',
      paramsSchema: submissionParamsSchema,
      bodySchema: acknowledgeSubmissionSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/privacy-requests', 'Privacy Requests', 'sessionOrUser', [
    {
      method: 'post',
      path: '/',
      operationId: 'createPrivacyRequest',
      summary: 'Create a privacy request',
      bodySchema: createPrivacyRequestSchema,
      successStatus: 201
    },
    {
      method: 'get',
      path: '/me',
      operationId: 'listOwnPrivacyRequests',
      summary: 'List privacy requests for the current owner',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}',
      operationId: 'getOwnPrivacyRequest',
      summary: 'Get a privacy request by id',
      paramsSchema: privacyRequestParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/privacy', 'Privacy', 'sessionOrUser', [
    {
      method: 'get',
      path: '/export',
      operationId: 'exportPrivacyData',
      summary: 'Export personal data for the current owner',
      successStatus: 200
    },
    {
      method: 'post',
      path: '/delete-request',
      operationId: 'createDeleteRequest',
      summary: 'Create a delete-account privacy request',
      bodySchema: deleteRequestSchema,
      successStatus: 201
    }
  ]),
  ...withBase('/api/v1/analytics', 'Analytics', 'public', [
    {
      method: 'get',
      path: '/public/local-intelligence',
      operationId: 'getPublicLocalIntelligence',
      summary: 'Get public local intelligence metrics',
      querySchema: localIntelligenceQuerySchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/analytics', 'Admin Analytics', 'bearer', [
    {
      method: 'get',
      path: '/overview',
      operationId: 'getAdminAnalyticsOverview',
      summary: 'Get analytics overview',
      querySchema: analyticsQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/heatmap',
      operationId: 'getAdminAnalyticsHeatmap',
      summary: 'Get analytics heatmap',
      querySchema: analyticsQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/trends',
      operationId: 'getAdminAnalyticsTrends',
      summary: 'Get analytics trends',
      querySchema: analyticsQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/categories',
      operationId: 'getAdminAnalyticsCategories',
      summary: 'Get analytics categories',
      querySchema: analyticsQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/languages',
      operationId: 'getAdminAnalyticsLanguages',
      summary: 'Get analytics languages',
      querySchema: analyticsQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/export',
      operationId: 'exportAdminAnalytics',
      summary: 'Generate analytics export payload',
      querySchema: analyticsExportQuerySchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1', 'Evidence', 'sessionOrUser', [
    {
      method: 'post',
      path: '/evidence/upload-url',
      operationId: 'createEvidenceUploadUrl',
      summary: 'Create an evidence upload URL',
      bodySchema: createUploadUrlSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/evidence/complete-upload',
      operationId: 'completeEvidenceUpload',
      summary: 'Complete an evidence upload',
      bodySchema: completeUploadBodySchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [{ name: 'file', description: 'Uploaded evidence file' }],
      successStatus: 200
    },
    {
      method: 'get',
      path: '/reports/{reportId}/evidence',
      operationId: 'listReportEvidence',
      summary: 'List evidence for a report',
      paramsSchema: reportEvidenceParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/evidence/{id}',
      operationId: 'getEvidence',
      summary: 'Get evidence by id',
      paramsSchema: evidenceParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/evidence/{id}/metadata',
      operationId: 'getEvidenceMetadata',
      summary: 'Get evidence metadata',
      paramsSchema: evidenceParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/evidence/{id}/audit-chain',
      operationId: 'getEvidenceAuditChain',
      summary: 'Get evidence audit chain',
      paramsSchema: evidenceParamsSchema,
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/evidence/{id}',
      operationId: 'deleteEvidence',
      summary: 'Soft delete evidence',
      paramsSchema: evidenceParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/evidence/{id}/verify-hash',
      operationId: 'verifyEvidenceHash',
      summary: 'Verify an evidence SHA-256 hash',
      paramsSchema: evidenceParamsSchema,
      bodySchema: verifyHashBodySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/evidence/{id}/transcribe',
      operationId: 'transcribeEvidence',
      summary: 'Create an evidence transcription',
      paramsSchema: evidenceParamsSchema,
      bodySchema: transcribeEvidenceBodySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/evidence/{id}/transcription',
      operationId: 'getEvidenceTranscription',
      summary: 'Get an evidence transcription',
      paramsSchema: evidenceParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/ai', 'AI', 'sessionOrUser', [
    {
      method: 'post',
      path: '/extract-incident-fields',
      operationId: 'extractIncidentFields',
      summary: 'Extract incident fields from narrative text',
      bodySchema: extractIncidentFieldsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/triage-report',
      operationId: 'triageReport',
      summary: 'Triage a report narrative or structured fields',
      bodySchema: triageReportSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/clarifying-questions',
      operationId: 'generateClarifyingQuestions',
      summary: 'Generate clarifying questions for a report',
      bodySchema: clarifyingQuestionsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/generate-summary',
      operationId: 'generateSummary',
      summary: 'Generate a SafeSpeak summary',
      bodySchema: generateSummarySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/translate',
      operationId: 'translateText',
      summary: 'Translate text content',
      bodySchema: translateSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/redact-pii',
      operationId: 'redactPii',
      summary: 'Redact personally identifiable information',
      bodySchema: redactPiiSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/synthesize-speech',
      operationId: 'synthesizeSpeech',
      summary: 'Synthesize spoken audio from text',
      bodySchema: synthesizeSpeechSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/transcribe-audio',
      operationId: 'transcribeAudio',
      summary: 'Transcribe uploaded audio',
      bodySchema: transcribeAudioBodySchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [{ name: 'audio', description: 'Audio file to transcribe' }],
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/scamshield', 'ScamShield', 'sessionOrUser', [
    {
      method: 'post',
      path: '/analyze-text',
      operationId: 'analyzeScamText',
      summary: 'Analyze scam text content',
      bodySchema: analyzeTextSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/analyze-email',
      operationId: 'analyzeScamEmail',
      summary: 'Analyze scam email content',
      bodySchema: analyzeEmailSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/analyze-screenshot',
      operationId: 'analyzeScamScreenshot',
      summary: 'Analyze screenshot or file evidence for scam signals',
      bodySchema: analyzeScreenshotSchema,
      requestContentType: 'multipart/form-data',
      multipartFiles: [
        {
          name: 'files',
          isArray: true,
          description: 'One or more image, PDF, or Word files for analysis'
        }
      ],
      successStatus: 201
    },
    {
      method: 'post',
      path: '/check-url',
      operationId: 'checkScamUrl',
      summary: 'Check a URL for scam risk',
      bodySchema: checkUrlSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/redact',
      operationId: 'redactScamContent',
      summary: 'Redact scam-related content',
      bodySchema: redactScamContentSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/generate-report-draft',
      operationId: 'generateScamReportDraft',
      summary: 'Generate a scam report draft',
      bodySchema: generateReportDraftSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/submit',
      operationId: 'submitScamReport',
      summary: 'Submit a scam report',
      bodySchema: submitScamReportSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/generate-report-draft',
      operationId: 'generateScamReportDraftById',
      summary: 'Generate a scam report draft from an existing analysis',
      paramsSchema: scamShieldParamsSchema,
      bodySchema: generateReportDraftByIdSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/{id}/submit',
      operationId: 'submitScamReportById',
      summary: 'Submit a scam report from an existing analysis',
      paramsSchema: scamShieldParamsSchema,
      bodySchema: submitScamReportByIdSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/{id}',
      operationId: 'getScamAnalysis',
      summary: 'Get a scam analysis by id',
      paramsSchema: scamShieldParamsSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/support', 'Support', 'sessionOrUser', [
    {
      method: 'get',
      path: '/services',
      operationId: 'listSupportServices',
      summary: 'List support services',
      querySchema: servicesQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/services/{id}',
      operationId: 'getSupportService',
      summary: 'Get a support service by id',
      paramsSchema: serviceParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/recommendations',
      operationId: 'getSupportRecommendations',
      summary: 'Get support recommendations',
      bodySchema: recommendationsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/warm-referral',
      operationId: 'createWarmReferral',
      summary: 'Create a warm referral request',
      bodySchema: warmReferralSchema,
      successStatus: 201
    },
    {
      method: 'get',
      path: '/advocates',
      operationId: 'listSupportAdvocates',
      summary: 'List support advocates',
      successStatus: 200
    },
    {
      method: 'post',
      path: '/advocate-request',
      operationId: 'createAdvocateRequest',
      summary: 'Create an advocate request',
      bodySchema: advocateRequestSchema,
      successStatus: 201
    },
    {
      method: 'post',
      path: '/help-request',
      operationId: 'createHelpRequest',
      summary: 'Create a general support help request',
      bodySchema: helpSupportRequestSchema,
      successStatus: 201
    },
    {
      method: 'get',
      path: '/safety-plans',
      operationId: 'listSafetyPlans',
      summary: 'List safety plans',
      successStatus: 200
    },
    {
      method: 'post',
      path: '/safety-plans',
      operationId: 'createSafetyPlan',
      summary: 'Create a safety plan',
      bodySchema: safetyPlanSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/safety-plans/{id}',
      operationId: 'updateSafetyPlan',
      summary: 'Update a safety plan',
      paramsSchema: safetyPlanParamsSchema,
      bodySchema: updateSafetyPlanSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin/support-services', 'Admin Support Services', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listAdminSupportServices',
      summary: 'List support services for admins',
      querySchema: adminServicesQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/',
      operationId: 'createAdminSupportService',
      summary: 'Create a support service',
      bodySchema: supportServiceSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateAdminSupportService',
      summary: 'Update a support service',
      paramsSchema: adminSupportServiceParamsSchema,
      bodySchema: updateSupportServiceSchema,
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/{id}',
      operationId: 'deleteAdminSupportService',
      summary: 'Delete a support service',
      paramsSchema: adminSupportServiceParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/warm-referrals',
      operationId: 'listAdminWarmReferrals',
      summary: 'List warm referrals for admins',
      querySchema: adminWarmReferralQuerySchema,
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/warm-referrals/{id}',
      operationId: 'updateAdminWarmReferral',
      summary: 'Update warm referral status',
      paramsSchema: safetyPlanParamsSchema,
      bodySchema: updateWarmReferralStatusSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/feedback', 'Feedback', 'sessionOrUser', [
    {
      method: 'post',
      path: '/',
      operationId: 'submitFeedback',
      summary: 'Submit user feedback',
      bodySchema: feedbackSubmissionSchema,
      successStatus: 201
    }
  ]),
  ...withBase('/api/v1/admin/feedback', 'Admin Feedback', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listAdminFeedback',
      summary: 'List feedback for admins',
      querySchema: adminFeedbackQuerySchema,
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/{id}',
      operationId: 'updateAdminFeedback',
      summary: 'Update admin feedback status or notes',
      paramsSchema: feedbackParamsSchema,
      bodySchema: updateAdminFeedbackSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/notifications', 'Notifications', 'bearer', [
    {
      method: 'get',
      path: '/',
      operationId: 'listUserNotifications',
      summary: 'List notifications for the current user',
      querySchema: userNotificationsQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/read',
      operationId: 'markUserNotificationRead',
      summary: 'Mark a user notification as read',
      bodySchema: markUserNotificationReadSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/read-all',
      operationId: 'markUserNotificationsRead',
      summary: 'Mark all eligible user notifications as read',
      bodySchema: markUserNotificationsReadSchema,
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/scope', 'Scope', 'public', [
    {
      method: 'get',
      path: '/bootstrap',
      operationId: 'getScopeBootstrap',
      summary: 'Get public scope bootstrap data',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/cultural-profiles',
      operationId: 'getScopeCulturalProfiles',
      summary: 'Get public cultural profiles for scope selection',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/scope', 'Scope', 'bearer', [
    {
      method: 'get',
      path: '/blueprint',
      operationId: 'getScopeBlueprint',
      summary: 'Get the admin scope blueprint',
      successStatus: 200
    }
  ]),
  ...withBase('/api/v1/admin', 'Admin', 'bearer', [
    {
      method: 'get',
      path: '/dashboard',
      operationId: 'getAdminDashboard',
      summary: 'Get admin dashboard overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/audit-logs',
      operationId: 'getAdminAuditLogs',
      summary: 'List admin audit logs',
      querySchema: auditLogsQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/notifications',
      operationId: 'getAdminNotifications',
      summary: 'List admin notifications',
      querySchema: adminNotificationsQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/notifications/read',
      operationId: 'markAdminNotificationRead',
      summary: 'Mark an admin notification as read',
      bodySchema: markAdminNotificationReadSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/notifications/read-all',
      operationId: 'markAdminNotificationsRead',
      summary: 'Mark all eligible admin notifications as read',
      bodySchema: markAdminNotificationsReadSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/users',
      operationId: 'listAdminUsers',
      summary: 'List admin-manageable users',
      querySchema: usersQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/users',
      operationId: 'createAdminUser',
      summary: 'Create an admin-managed user',
      bodySchema: createAdminUserSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/users/{id}',
      operationId: 'updateAdminUser',
      summary: 'Update an admin-managed user',
      paramsSchema: adminParamsSchema,
      bodySchema: updateAdminUserSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/taxonomies',
      operationId: 'listAdminTaxonomies',
      summary: 'List taxonomies',
      querySchema: taxonomyQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/taxonomies/{id}',
      operationId: 'getAdminTaxonomy',
      summary: 'Get a taxonomy by id',
      paramsSchema: adminParamsSchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/taxonomies',
      operationId: 'createAdminTaxonomy',
      summary: 'Create a taxonomy',
      bodySchema: taxonomySchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/taxonomies/{id}',
      operationId: 'updateAdminTaxonomy',
      summary: 'Update a taxonomy',
      paramsSchema: adminParamsSchema,
      bodySchema: updateTaxonomySchema,
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/taxonomies/{id}',
      operationId: 'deleteAdminTaxonomy',
      summary: 'Delete a taxonomy',
      paramsSchema: adminParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/cultural-profiles/overview',
      operationId: 'getAdminCulturalProfilesOverview',
      summary: 'Get cultural profiles overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/cultural-profiles',
      operationId: 'listAdminCulturalProfiles',
      summary: 'List cultural profiles',
      querySchema: culturalProfileQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/cultural-profiles',
      operationId: 'createAdminCulturalProfile',
      summary: 'Create a cultural profile',
      bodySchema: culturalProfileSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/cultural-profiles/{id}',
      operationId: 'updateAdminCulturalProfile',
      summary: 'Update a cultural profile',
      paramsSchema: adminParamsSchema,
      bodySchema: updateCulturalProfileSchema,
      successStatus: 200
    },
    {
      method: 'delete',
      path: '/cultural-profiles/{id}',
      operationId: 'deleteAdminCulturalProfile',
      summary: 'Delete a cultural profile',
      paramsSchema: adminParamsSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/destinations',
      operationId: 'listAdminDestinations',
      summary: 'List integration destinations',
      querySchema: destinationQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/destinations',
      operationId: 'createAdminDestination',
      summary: 'Create an integration destination',
      bodySchema: destinationSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/destinations/{id}',
      operationId: 'updateAdminDestination',
      summary: 'Update an integration destination',
      paramsSchema: adminParamsSchema,
      bodySchema: updateDestinationSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/submission-templates',
      operationId: 'listAdminSubmissionTemplates',
      summary: 'List submission templates',
      querySchema: submissionTemplateQuerySchema,
      successStatus: 200
    },
    {
      method: 'post',
      path: '/submission-templates',
      operationId: 'createAdminSubmissionTemplate',
      summary: 'Create a submission template',
      bodySchema: submissionTemplateSchema,
      successStatus: 201
    },
    {
      method: 'patch',
      path: '/submission-templates/{id}',
      operationId: 'updateAdminSubmissionTemplate',
      summary: 'Update a submission template',
      paramsSchema: adminParamsSchema,
      bodySchema: updateSubmissionTemplateSchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/report-deliveries',
      operationId: 'listAdminReportDeliveries',
      summary: 'List report delivery attempts',
      querySchema: reportDeliveryQuerySchema,
      successStatus: 200
    },
    {
      method: 'get',
      path: '/knowledge-sources',
      operationId: 'listAdminKnowledgeSourcesOverview',
      summary: 'Get admin knowledge sources overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/educational-content',
      operationId: 'getAdminEducationalContentOverview',
      summary: 'Get admin educational content overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/data-protection/overview',
      operationId: 'getAdminDataProtectionOverview',
      summary: 'Get admin data protection overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/ai-engine/overview',
      operationId: 'getAdminAiEngineOverview',
      summary: 'Get admin AI engine overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/language-packs/overview',
      operationId: 'getAdminLanguagePacksOverview',
      summary: 'Get admin language packs overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/insights/incident-insights/overview',
      operationId: 'getAdminIncidentInsightsOverview',
      summary: 'Get admin incident insights overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/platform-health',
      operationId: 'getAdminPlatformHealthOverview',
      summary: 'Get admin platform health overview',
      successStatus: 200
    },
    {
      method: 'get',
      path: '/privacy-requests',
      operationId: 'listAdminPrivacyRequests',
      summary: 'List privacy requests for admins',
      querySchema: privacyRequestQuerySchema,
      successStatus: 200
    },
    {
      method: 'patch',
      path: '/privacy-requests/{id}',
      operationId: 'updateAdminPrivacyRequest',
      summary: 'Update a privacy request',
      paramsSchema: adminParamsSchema,
      bodySchema: updatePrivacyRequestSchema,
      successStatus: 200
    }
  ])
];

const buildPaths = (): Record<string, Record<string, unknown>> => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routeDocs) {
    const pathItem = (paths[route.path] ??= {});
    pathItem[route.method] = {
      tags: [route.tag],
      summary: route.summary,
      description: route.description,
      operationId: route.operationId,
      deprecated: route.deprecated,
      security: getSecurity(route.security),
      parameters: [
        ...(route.paramsSchema
          ? buildParameters(`${route.operationId}Params`, route.paramsSchema, 'path')
          : []),
        ...(route.querySchema
          ? buildParameters(`${route.operationId}Query`, route.querySchema, 'query')
          : [])
      ],
      requestBody: buildRequestBody(route),
      responses: buildResponses(route)
    };
  }

  return paths;
};

const openApiPaths = buildPaths();

const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: `${env.APP_NAME} API`,
    version: env.APP_VERSION,
    description:
      'Comprehensive Swagger/OpenAPI documentation for the active SafeSpeak backend routes. All paths documented here are sourced from the mounted Express route surface in the backend.'
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: 'Local development server'
    }
  ],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Sessions' },
    { name: 'Consents' },
    { name: 'Conversation Flow' },
    { name: 'Profile' },
    { name: 'Platform Settings' },
    { name: 'Admin Platform Settings' },
    { name: 'Microeducation' },
    { name: 'Admin Microeducation' },
    { name: 'Content Pages' },
    { name: 'Admin Content Pages' },
    { name: 'Content Resources' },
    { name: 'Admin Content Resources' },
    { name: 'Media Assets' },
    { name: 'Admin Media Assets' },
    { name: 'Resources' },
    { name: 'Admin Resources' },
    { name: 'Reports' },
    { name: 'Privacy Requests' },
    { name: 'Privacy' },
    { name: 'Analytics' },
    { name: 'Admin Analytics' },
    { name: 'Evidence' },
    { name: 'AI' },
    { name: 'ScamShield' },
    { name: 'Support' },
    { name: 'Admin Support Services' },
    { name: 'Feedback' },
    { name: 'Admin Feedback' },
    { name: 'Notifications' },
    { name: 'Scope' },
    { name: 'Admin' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      },
      anonymousSessionAuth: {
        type: 'apiKey',
        in: 'header',
        name: SAFE_SPEAK_SESSION_HEADER
      }
    },
    schemas: Object.fromEntries(componentSchemas.entries())
  },
  paths: openApiPaths
};

export { openApiDocument, routeDocs };
