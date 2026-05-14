import { connectDatabase, disconnectDatabase } from '@config/database';
import { logger } from '@common/utils/logger';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';

const defaultMicroEducationItems = [
  {
    title: 'Bullying',
    tag: 'Cyber',
    summary: 'Protect your digital footprint & data from potential online threats.',
    readTimeLabel: '4 min read',
    cta: 'Get Protected',
    detailHeading: 'Spot harmful behavior early.',
    detailBody: 'Look for repeated, targeted, or intimidating behavior and write down what happened while the details are fresh.',
    detailTakeaway: 'If behavior is repeated, targeted, or makes someone feel unsafe, document the pattern.',
    tone: 'blue',
    chips: ['harassment', 'safety'],
    duration: 'quick',
    format: 'interactive',
    status: 'published',
    sortOrder: 0,
    views: 0
  },
  {
    title: 'Discrimination',
    tag: 'Harassment',
    summary: 'Discrimination occurs when employees are treated unfairly for personal traits.',
    readTimeLabel: '4 min read',
    cta: 'Start Now',
    detailHeading: 'Recognize unfair treatment and preserve details.',
    detailBody: 'Record what happened, who was involved, where it happened, and whether the behavior affected work, study, housing, or safety.',
    detailTakeaway: 'A short factual record can help a support service understand the pattern.',
    tone: 'orange',
    chips: ['harassment', 'rights'],
    duration: 'deep',
    format: 'video',
    status: 'published',
    sortOrder: 1,
    views: 0
  },
  {
    title: 'Online Safety',
    tag: 'Protection',
    summary: 'Protect your digital footprint & data from potential online threats.',
    readTimeLabel: '4 min read',
    cta: 'Get Protected',
    detailHeading: 'Reduce digital exposure before sharing sensitive details.',
    detailBody: 'Use a private device when possible, check notification previews, and avoid saving sensitive screenshots in shared accounts or public albums.',
    detailTakeaway: 'Privacy tools work best when the device and account are also safe to use.',
    tone: 'green',
    chips: ['safety'],
    duration: 'quick',
    format: 'video',
    status: 'published',
    sortOrder: 2,
    views: 0
  },
  {
    title: 'Migrant & Student Rights',
    tag: 'Legal',
    summary: 'Discrimination occurs when employees are treated unfairly for personal traits.',
    readTimeLabel: '4 min read',
    cta: 'Start Now',
    detailHeading: 'Understand rights, records, and safer next steps.',
    detailBody: 'Identify the setting involved, keep copies of relevant messages or documents, and ask a trusted service which reporting pathway fits.',
    detailTakeaway: 'You do not need to choose a formal report immediately to start preserving useful information.',
    tone: 'amber',
    chips: ['rights'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 3,
    views: 0
  },
  {
    title: 'Mental Health',
    tag: 'Mental',
    summary: 'Protect your digital footprint & data from potential online threats.',
    readTimeLabel: '4 min read',
    cta: 'Start Now',
    detailHeading: 'Lower pressure while deciding what comes next.',
    detailBody: 'Move to a safer place if possible, choose one trusted person or service to contact, and keep the next action small and specific.',
    detailTakeaway: 'A useful first step is the one you can take safely right now.',
    tone: 'violet',
    chips: ['mentalHealth'],
    duration: 'quick',
    format: 'interactive',
    status: 'published',
    sortOrder: 4,
    views: 0
  },
  {
    title: 'Legal Aid Basics',
    tag: 'Fundamentals',
    summary: 'Discrimination occurs when employees are treated unfairly for personal traits.',
    readTimeLabel: '4 min read',
    cta: 'Start Now',
    detailHeading: 'Know what information legal support may need.',
    detailBody: 'Keep dates, names, copies of messages, and any policies or documents connected to the situation so support services can review the facts.',
    detailTakeaway: 'Simple, consistent notes usually matter more than a perfect statement written all at once.',
    tone: 'teal',
    chips: ['rights'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 5,
    views: 0
  }
] as const;

const seedDefaultMicroEducation = async (): Promise<void> => {
  await connectDatabase();

  let upsertedCount = 0;
  let updatedCount = 0;

  for (const item of defaultMicroEducationItems) {
    const result = await MicroEducationModel.updateOne(
      { title: item.title },
      {
        $set: {
          ...item,
          updatedAt: new Date()
        },
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
    { upsertedCount, updatedCount, total: defaultMicroEducationItems.length },
    'Seeded microeducation defaults'
  );

  await disconnectDatabase();
};

void seedDefaultMicroEducation().catch(async (error: unknown) => {
  logger.error({ error }, 'Failed to seed microeducation defaults');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
