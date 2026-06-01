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
    title: 'Protect Your Identity After a Scam',
    tag: 'Scam',
    summary: 'Take early steps to secure accounts, bank access, and identity documents after a scam or privacy breach.',
    readTimeLabel: '5 min read',
    cta: 'Review steps',
    detailHeading: 'Protect accounts before the problem spreads.',
    detailBody: 'If it feels safe, contact your bank, change passwords, turn on extra account security, and watch for misuse of your identity details or documents.',
    detailTakeaway: 'Fast account and identity protection can reduce the damage after a scam.',
    tone: 'green',
    chips: ['safety', 'rights'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 3,
    views: 0
  },
  {
    title: 'What to Do After a Data Breach',
    tag: 'Privacy',
    summary: 'Use a short checklist to understand what was exposed, what to save, and what to ask the organisation involved.',
    readTimeLabel: '5 min read',
    cta: 'Open checklist',
    detailHeading: 'Ask clear questions about the exposure.',
    detailBody: 'Keep notices, emails, or screenshots about the breach and ask what information was exposed, how it happened, and what the organisation is doing now.',
    detailTakeaway: 'A simple record of what was exposed can help with privacy and complaint steps later.',
    tone: 'teal',
    chips: ['rights', 'safety'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 4,
    views: 0
  },
  {
    title: 'Image-Based Abuse and Private Photos',
    tag: 'Online Harm',
    summary: 'Learn safer first steps when intimate photos or private images are shared or threatened without permission.',
    readTimeLabel: '4 min read',
    cta: 'See safer options',
    detailHeading: 'Save proof before you act, if it feels safe.',
    detailBody: 'Keep screenshots, links, usernames, and messages somewhere private, and consider platform reporting or eSafety options before the content spreads further.',
    detailTakeaway: 'Preserving proof safely can help with removal requests and later reporting.',
    tone: 'blue',
    chips: ['harassment', 'safety'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 5,
    views: 0
  },
  {
    title: 'Online Blackmail or Threats',
    tag: 'Threats',
    summary: 'Use practical steps when someone is threatening to leak private messages, photos, or personal information.',
    readTimeLabel: '4 min read',
    cta: 'Plan next steps',
    detailHeading: 'Keep the pressure from escalating if you can.',
    detailBody: 'Save the messages, avoid negotiating under pressure, and focus on immediate safety, account security, and platform or police options if the threat is escalating.',
    detailTakeaway: 'Threats often become easier to explain when the messages, dates, and accounts are saved clearly.',
    tone: 'orange',
    chips: ['harassment', 'safety'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 6,
    views: 0
  },
  {
    title: 'Saving Evidence Safely',
    tag: 'Evidence',
    summary: 'Keep screenshots, messages, dates, and account details in a safer format without exposing them further.',
    readTimeLabel: '4 min read',
    cta: 'Learn how',
    detailHeading: 'Simple evidence is often enough to start.',
    detailBody: 'Store screenshots, links, dates, names, and notes in a private place, and avoid editing or reposting content that could increase your exposure.',
    detailTakeaway: 'Short, factual records are often more useful than trying to capture everything perfectly.',
    tone: 'violet',
    chips: ['safety', 'rights'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 7,
    views: 0
  },
  {
    title: 'Employer Sharing Health Information',
    tag: 'Workplace Privacy',
    summary: 'Understand safer first steps if an employer shared health or medical information without your permission.',
    readTimeLabel: '5 min read',
    cta: 'Review privacy steps',
    detailHeading: 'Keep a clear record of the disclosure.',
    detailBody: 'Save emails, messages, meeting notes, and any policy references, and write down who shared the information, who saw it, and how it affected you.',
    detailTakeaway: 'A workplace privacy concern does not need to be workplace bullying to matter.',
    tone: 'amber',
    chips: ['rights', 'safety'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 8,
    views: 0
  },
  {
    title: 'Privacy Complaint Steps',
    tag: 'Complaints',
    summary: 'See practical privacy complaint questions and evidence steps before deciding whether to make a complaint.',
    readTimeLabel: '5 min read',
    cta: 'See complaint steps',
    detailHeading: 'Clarify what happened before you complain.',
    detailBody: 'Keep notices, screenshots, and a short timeline, and note what outcome you want before considering OAIC, workplace, or other complaint pathways.',
    detailTakeaway: 'Complaint steps usually become easier when the facts, dates, and documents are in one place.',
    tone: 'teal',
    chips: ['rights', 'safety'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 9,
    views: 0
  },
  {
    title: 'Domestic Violence Safety Planning',
    tag: 'Safety',
    summary: 'Use safer first-step planning when a partner or family member may monitor, control, or escalate harm.',
    readTimeLabel: '5 min read',
    cta: 'Plan safely',
    detailHeading: 'Keep safety planning practical and private.',
    detailBody: 'Think about a safer device, one trusted contact, important documents, medicines, transport, and where you could go if you needed to leave quickly.',
    detailTakeaway: 'A small safety plan can still help, even if you are not ready to report or leave today.',
    tone: 'orange',
    chips: ['safety', 'mentalHealth'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 10,
    views: 0
  },
  {
    title: 'Migration or Visa Pressure',
    tag: 'Migration',
    summary: 'Understand safer first steps when someone is using visa status, sponsorship, or migration pressure to control you.',
    readTimeLabel: '5 min read',
    cta: 'Review options',
    detailHeading: 'Keep messages and documents that show the pressure.',
    detailBody: 'Save texts, emails, contracts, payment requests, agent details, and visa-related threats somewhere private before deciding what service to contact.',
    detailTakeaway: 'Migration pressure can be part of abuse, coercion, or a scam. You do not need to sort that out alone.',
    tone: 'amber',
    chips: ['rights', 'safety'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 11,
    views: 0
  },
  {
    title: 'Elder Scam and Identity Safety',
    tag: 'Scam',
    summary: 'Use calmer, practical steps when an older person may have shared money, documents, or account access with a scammer.',
    readTimeLabel: '4 min read',
    cta: 'See next steps',
    detailHeading: 'Reduce harm without adding pressure.',
    detailBody: 'Pause new payments, contact the bank if needed, save suspicious messages, and keep a simple record of what information or money may have been shared.',
    detailTakeaway: 'Clear, low-pressure steps can help protect both finances and dignity after a scam.',
    tone: 'green',
    chips: ['safety', 'rights'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 12,
    views: 0
  },
  {
    title: 'Workplace Bullying: Keep a Clear Record',
    tag: 'Workplace',
    summary: 'Create a short factual record of bullying, humiliation, threats, and repeated behavior at work.',
    readTimeLabel: '4 min read',
    cta: 'Record safely',
    detailHeading: 'Short factual notes are often enough.',
    detailBody: 'Write down dates, locations, who was present, what was said or done, and how it affected work, safety, or wellbeing. Keep copies of messages if it feels safe.',
    detailTakeaway: 'A consistent timeline is often more useful than a perfect statement written all at once.',
    tone: 'blue',
    chips: ['rights', 'harassment'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 13,
    views: 0
  },
  {
    title: 'Workplace Discrimination and Fair Treatment',
    tag: 'Rights',
    summary: 'Use practical evidence and support steps if work decisions may be tied to race, religion, disability, pregnancy, or another protected attribute.',
    readTimeLabel: '5 min read',
    cta: 'Review rights',
    detailHeading: 'Separate unfair treatment from general workplace conflict.',
    detailBody: 'Keep rosters, messages, policy documents, performance notes, and examples that show different treatment or comments linked to a protected attribute.',
    detailTakeaway: 'Discrimination concerns often become clearer when you match what happened with dates, documents, and who was involved.',
    tone: 'teal',
    chips: ['rights', 'safety'],
    duration: 'deep',
    format: 'guide',
    status: 'published',
    sortOrder: 14,
    views: 0
  },
  {
    title: 'Racial Abuse or Hate Speech',
    tag: 'Discrimination',
    summary: 'Understand safer evidence, support, and reporting steps after racism, hate speech, or vilification.',
    readTimeLabel: '4 min read',
    cta: 'See options',
    detailHeading: 'Keep the details while they are still clear.',
    detailBody: 'If it feels safe, save screenshots, photos, witness names, locations, dates, and exact words or posts that help explain what happened.',
    detailTakeaway: 'A short record can help support services explain the difference between a one-off incident and a broader pattern.',
    tone: 'orange',
    chips: ['harassment', 'rights'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 15,
    views: 0
  },
  {
    title: 'School Bullying or School Racism',
    tag: 'School',
    summary: 'Use simple steps when bullying, threats, or racism involve school, classmates, staff, or school online spaces.',
    readTimeLabel: '4 min read',
    cta: 'Open guide',
    detailHeading: 'Keep the school context clear.',
    detailBody: 'Write down whether it happened in class, online, on transport, or around school events, and save messages or witness details if it feels safe.',
    detailTakeaway: 'School incidents are often easier to act on when the people, place, and timing are clear.',
    tone: 'blue',
    chips: ['harassment', 'safety'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 16,
    views: 0
  },
  {
    title: 'Reporting Harmful Content to a Platform or eSafety',
    tag: 'Online Safety',
    summary: 'See what to save before reporting harmful content to a platform or the eSafety Commissioner.',
    readTimeLabel: '4 min read',
    cta: 'Report safely',
    detailHeading: 'Save enough before posts disappear.',
    detailBody: 'Keep the username, URL, screenshots, timestamps, and any report reference numbers so you still have a clear record after content is removed.',
    detailTakeaway: 'A small evidence pack can make platform or eSafety reports much easier to follow up.',
    tone: 'green',
    chips: ['safety', 'rights'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 17,
    views: 0
  },
  {
    title: 'Interpreter and Language Support',
    tag: 'Support',
    summary: 'Use language support or interpreter options when English is making it harder to explain what happened or contact a service.',
    readTimeLabel: '3 min read',
    cta: 'Find language support',
    detailHeading: 'Ask for language help early if you need it.',
    detailBody: 'When contacting a service, ask whether they can arrange an interpreter, support a preferred language, or help slow the process down so you can explain clearly.',
    detailTakeaway: 'Needing language support should not stop you from getting help or understanding your options.',
    tone: 'violet',
    chips: ['mentalHealth', 'rights'],
    duration: 'quick',
    format: 'guide',
    status: 'published',
    sortOrder: 18,
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
    sortOrder: 19,
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
    sortOrder: 20,
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
    sortOrder: 21,
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
