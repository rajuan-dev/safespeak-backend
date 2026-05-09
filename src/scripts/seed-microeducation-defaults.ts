import { connectDatabase, disconnectDatabase } from '@config/database';
import { MicroEducationModel } from '@modules/microeducation/microeducation.model';

const defaultMicroEducationItems = [
  {
    title: 'Bullying',
    tag: 'Cyber',
    summary: 'Protect your digital footprint & data from potential online threats.',
    cta: 'Get Protected',
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
    cta: 'Start Now',
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
    cta: 'Get Protected',
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
    cta: 'Start Now',
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
    cta: 'Start Now',
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
    cta: 'Start Now',
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

  console.log(
    `Seeded microeducation defaults. upserted=${upsertedCount} updated=${updatedCount} total=${defaultMicroEducationItems.length}`
  );

  await disconnectDatabase();
};

void seedDefaultMicroEducation().catch(async (error: unknown) => {
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
