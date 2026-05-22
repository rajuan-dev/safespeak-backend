import { connectDatabase, disconnectDatabase } from '@config/database';
import { logger } from '@common/utils/logger';
import { getKnowledgeSourceReadiness } from '@modules/rag/rag.service';

const FAIL_ON_NOT_READY = process.argv.includes('--fail-on-not-ready');
const SCRIPT_SESSION_ID = '000000000000000000000000';

const run = async (): Promise<void> => {
  await connectDatabase();

  try {
    const readiness = await getKnowledgeSourceReadiness({
      owner: { sessionId: SCRIPT_SESSION_ID },
      actorType: 'admin',
      userAgent: 'rag-readiness-report-script'
    });

    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);

    if (FAIL_ON_NOT_READY && !readiness.summary.readyForPublicLegalRag) {
      process.exitCode = 2;
    }
  } finally {
    await disconnectDatabase();
  }
};

void run().catch(async (error: unknown) => {
  logger.error({ error }, 'rag:readiness failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
