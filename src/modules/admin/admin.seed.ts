import { env } from '@config/env';
import { logger } from '@common/utils/logger';
import { createAuditLog } from '@modules/audit/audit.service';
import { UserModel } from '@modules/auth/auth.model';
import { hashPassword, verifyPassword } from '@modules/auth/auth.utils';
import { AdminDestinationModel, AdminSubmissionTemplateModel } from './admin.model';

const defaultReportDestinations = [
  {
    type: 'anti_discrimination_agency',
    key: 'anti-discrimination-nsw',
    name: 'Anti-Discrimination NSW',
    channel: 'booking_link',
    jurisdiction: 'NSW',
    languages: ['en'],
    endpoint: 'https://antidiscrimination.nsw.gov.au/complaints.html',
    contactPhone: '1800 670 812',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Review the prepared summary before using the official complaint pathway.',
      'Keep copies of evidence and any reference numbers you receive.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: ['racial_abuse', 'racism_discrimination', 'workplace_bullying'],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Matches racial abuse, discrimination, vilification, and NSW anti-discrimination support pathways.'
    }
  },
  {
    type: 'police',
    key: 'nsw-police',
    name: 'NSW Police',
    channel: 'manual_export_json',
    jurisdiction: 'NSW',
    languages: ['en'],
    contactPhone: '131 444',
    minimumRequiredInfo: ['summary', 'where'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Use 000 for immediate danger.',
      'Use the prepared report to support a police contact if you choose to proceed.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: [
        'racial_abuse',
        'racism_discrimination',
        'domestic_violence',
        'harassment',
        'online_abuse',
        'scam_fraud'
      ],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Suggested when the report may involve immediate safety, threats, harassment, theft, or criminal conduct.'
    }
  },
  {
    type: 'esafety',
    key: 'esafety-commissioner',
    name: 'eSafety Commissioner',
    channel: 'booking_link',
    jurisdiction: 'AU',
    languages: ['en'],
    endpoint: 'https://www.esafety.gov.au/report',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Use the official eSafety report pathway for online abuse or image-based abuse.',
      'Keep screenshots, URLs, usernames, and platform details where safe.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: ['online_abuse', 'racial_abuse', 'racism_discrimination', 'cyber_scam'],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Matches online abuse, harmful digital content, cyber abuse, and evidence preservation needs.'
    }
  },
  {
    type: 'legal_aid',
    key: 'legal-aid-nsw',
    name: 'Legal Aid NSW',
    channel: 'booking_link',
    jurisdiction: 'NSW',
    languages: ['en'],
    endpoint: 'https://www.legalaid.nsw.gov.au/ways-to-get-help/apply-for-legal-aid',
    contactPhone: '1300 888 529',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Use the prepared summary to ask for information about legal options.',
      'SafeSpeak information is not legal advice.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: [
        'racial_abuse',
        'racism_discrimination',
        'migrant_challenges',
        'domestic_violence',
        'harassment'
      ],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Suggested for users seeking legal information, rights context, or referral pathways.'
    }
  },
  {
    type: 'community_legal_centre',
    key: 'community-legal-centres-nsw',
    name: 'Community Legal Centres NSW',
    channel: 'booking_link',
    jurisdiction: 'NSW',
    languages: ['en'],
    endpoint: 'https://www.clcnsw.org.au/help',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Use the prepared report to help explain the situation to a community legal service.',
      'Availability and eligibility depend on the selected service.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: [
        'racial_abuse',
        'racism_discrimination',
        'migrant_challenges',
        'workplace_bullying',
        'harassment'
      ],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Suggested for community legal help, culturally safe referral, and practical next-step support.'
    }
  },
  {
    type: 'scamwatch',
    key: 'scamwatch',
    name: 'Scamwatch',
    channel: 'booking_link',
    jurisdiction: 'AU',
    languages: ['en'],
    endpoint: 'https://www.scamwatch.gov.au/report-a-scam',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Report scam details through the official Scamwatch pathway if you choose to proceed.',
      'Do not include passwords or one-time codes.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: ['cyber_scam', 'scam_fraud', 'online_abuse'],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Matches scam, fraud, phishing, payment redirection, and suspicious message reports.'
    }
  },
  {
    type: 'reportcyber',
    key: 'reportcyber-acsc',
    name: 'ReportCyber',
    channel: 'booking_link',
    jurisdiction: 'AU',
    languages: ['en'],
    endpoint: 'https://www.cyber.gov.au/report-and-recover/report',
    minimumRequiredInfo: ['summary'],
    anonymityOptions: ['identified', 'pseudonymous'],
    expectedNextSteps: [
      'Use ReportCyber for cybercrime reports when you choose to continue.',
      'Keep device, account, transaction, URL, and screenshot details where safe.'
    ],
    consentRequired: true,
    supportsAcknowledgement: false,
    isActive: true,
    metadata: {
      incidentTypes: ['cyber_scam', 'scam_fraud', 'online_abuse'],
      requiredConsentFlags: ['share_with_agencies'],
      recommendationReason:
        'Matches cybercrime, account compromise, online fraud, and digital evidence pathways.'
    }
  }
] as const;

const defaultSubmissionTemplates = defaultReportDestinations.map((destination) => ({
  key: `${destination.key}-handoff-template`,
  name: `${destination.name} handoff template`,
  destinationType: destination.type,
  channel: destination.channel,
  jurisdiction: destination.jurisdiction,
  titleTemplate: `SafeSpeak ${destination.name} report {{refNo}}`,
  summaryTemplate: '{{summary}}',
  fieldMappings: [
    { source: 'refNo', target: 'referenceNumber', required: true },
    { source: 'summary', target: 'incidentSummary', required: true },
    { source: 'incidentType', target: 'incidentType', required: false },
    { source: 'severity', target: 'severity', required: false },
    { source: 'jurisdiction', target: 'jurisdiction', required: true },
    { source: 'language', target: 'language', required: true },
    { source: 'destination.name', target: 'destinationName', required: true },
    { source: 'anonymityMode', target: 'anonymityMode', required: true },
    { source: 'notes', target: 'userNotes', required: false }
  ],
  staticPayload: {
    schemaVersion: '2026-05-report-handoff-v1',
    source: 'safespeak',
    destinationKey: destination.key,
    informationOnly: true
  },
  acknowledgementMode: 'manual',
  attachmentMode: 'metadata_only',
  isActive: true,
  metadata: {
    seeded: true,
    destinationKey: destination.key,
    requiredConsentFlags: destination.metadata.requiredConsentFlags
  }
}));

export const seedDefaultSuperAdmin = async (): Promise<void> => {
  if (!env.ENABLE_ADMIN_SEED) {
    logger.info('Default super admin seed skipped');
    return;
  }

  const email = env.DEFAULT_SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = env.DEFAULT_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    logger.warn('Default super admin seed is enabled but credentials are not configured');
    return;
  }

  const existingAdmin = await UserModel.findOne({ email }).select('+passwordHash');

  if (existingAdmin) {
    const passwordMatches = await verifyPassword(password, existingAdmin.passwordHash);

    if (!passwordMatches) {
      existingAdmin.passwordHash = await hashPassword(password);
      existingAdmin.role = 'super_admin';
      existingAdmin.status = 'active';
      existingAdmin.isEmailVerified = true;
      existingAdmin.refreshTokenHash = undefined;
      await existingAdmin.save();

      logger.info({ email }, 'Default super admin password updated');
      return;
    }

    logger.info({ email }, 'Default super admin already exists');
    return;
  }

  const passwordHash = await hashPassword(password);
  const admin = await UserModel.create({
    email,
    fullName: env.DEFAULT_SUPER_ADMIN_FULL_NAME,
    passwordHash,
    role: 'super_admin',
    status: 'active',
    isEmailVerified: true
  });

  await createAuditLog({
    actorType: 'system',
    action: 'admin.seed_super_admin',
    resourceType: 'auth',
    resourceId: admin._id.toString(),
    metadata: {
      email,
      role: 'super_admin'
    }
  });

  logger.info({ email }, 'Default super admin created');
};

export const seedDefaultReportDestinations = async (): Promise<void> => {
  const results = await Promise.all(
    defaultReportDestinations.map((destination) =>
      AdminDestinationModel.updateOne(
        { type: destination.type, key: destination.key },
        {
          $setOnInsert: destination
        },
        { upsert: true }
      )
    )
  );
  const insertedCount = results.reduce(
    (count, result) => count + (result.upsertedCount ?? 0),
    0
  );

  logger.info(
    {
      insertedCount,
      totalDefaults: defaultReportDestinations.length
    },
    'Default report destinations ready'
  );
};

export const seedDefaultSubmissionTemplates = async (): Promise<void> => {
  const results = await Promise.all(
    defaultSubmissionTemplates.map((template) =>
      AdminSubmissionTemplateModel.updateOne(
        { key: template.key },
        {
          $setOnInsert: template
        },
        { upsert: true }
      )
    )
  );
  const insertedCount = results.reduce(
    (count, result) => count + (result.upsertedCount ?? 0),
    0
  );

  logger.info(
    {
      insertedCount,
      totalDefaults: defaultSubmissionTemplates.length
    },
    'Default submission templates ready'
  );
};
