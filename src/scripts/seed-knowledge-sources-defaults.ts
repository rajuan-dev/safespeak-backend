import { connectDatabase, disconnectDatabase } from '@config/database';
import { logger } from '@common/utils/logger';
import { RagKnowledgeSourceModel } from '@modules/rag/rag.model';

const templates = {
  riskPhrasing:
    'Based on recent reports of {Scam_Type}, we have identified a high probability of fraudulent activity.\n\nThis pattern typically involves long-term emotional manipulation followed by requests for cryptocurrency transfers.\n\nRecommendation: Cease all communication immediately. Do not transfer any funds. The platform advises users to report this profile.',
  disclaimerPhrasing:
    "SafeSpeak provides guidance and referral support, not legal advice.\n\nBefore sharing information with a partner organization, confirm the user's consent status and review any jurisdiction-specific requirements.\n\nUse plain, non-judgmental language in every explanation.",
  generalResponses:
    "Acknowledge the user's experience, summarise the immediate safety steps, and provide the next best support option.\n\nWhen confidence is low, route the draft to human review before publishing or sharing externally."
};

const defaultKnowledgeSources = [
  {
    title: 'New Cyber Policy 2024',
    description: 'Operational guidance for safer online interactions and abuse response routing.',
    sourceCategory: 'official_legal_source',
    jurisdiction: 'AU',
    topic: 'online_safety',
    sourceType: 'Policy',
    language: 'en',
    publisher: 'SafeSpeak Policy Monitor',
    licenseStatus: 'Public information',
    lastUpdated: new Date('2024-07-01T00:00:00.000Z'),
    nextReviewAt: new Date('2026-07-01T00:00:00.000Z'),
    legalReviewed: true,
    status: 'approved',
    version: 1,
    ingestedAt: new Date(),
    metadata: {
      adminCategory: 'Legislation',
      templates
    }
  },
  {
    title: 'Phishing Pattern: Crypto-Romance',
    description: 'Emerging scam pattern notes for romance-based cryptocurrency manipulation.',
    sourceCategory: 'admin_content',
    jurisdiction: 'Global',
    topic: 'scam',
    sourceType: 'Report',
    language: 'en',
    publisher: 'SafeSpeak Intelligence Team',
    licenseStatus: 'Internal use',
    lastUpdated: new Date('2026-05-01T00:00:00.000Z'),
    nextReviewAt: new Date('2026-08-01T00:00:00.000Z'),
    legalReviewed: false,
    status: 'pending_review',
    version: 1,
    metadata: {
      adminCategory: 'Scam Pattern',
      templates
    }
  },
  {
    title: 'GDPR Amendment v3.2',
    description: 'Privacy regulation phrasing for consent, retention, and user data rights explanations.',
    sourceCategory: 'official_legal_source',
    jurisdiction: 'Global',
    topic: 'privacy',
    sourceType: 'Regulation',
    language: 'en',
    publisher: 'SafeSpeak Legal Review',
    licenseStatus: 'Public information',
    lastUpdated: new Date('2024-03-12T00:00:00.000Z'),
    nextReviewAt: new Date('2026-03-12T00:00:00.000Z'),
    legalReviewed: true,
    status: 'approved',
    version: 3,
    ingestedAt: new Date(),
    metadata: {
      adminCategory: 'Regulation',
      templates
    }
  }
] as const;

const seedKnowledgeSources = async (): Promise<void> => {
  await connectDatabase();

  let upsertedCount = 0;
  let updatedCount = 0;

  for (const source of defaultKnowledgeSources) {
    const result = await RagKnowledgeSourceModel.updateOne(
      { title: source.title },
      {
        $set: source,
        $unset: {
          deletedAt: ''
        }
      },
      { upsert: true }
    );

    upsertedCount += result.upsertedCount;
    updatedCount += result.modifiedCount;
  }

  logger.info(
    { upsertedCount, updatedCount, total: defaultKnowledgeSources.length },
    'Seeded knowledge source defaults'
  );

  await disconnectDatabase();
};

void seedKnowledgeSources().catch(async (error: unknown) => {
  logger.error({ error }, 'Failed to seed knowledge source defaults');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
