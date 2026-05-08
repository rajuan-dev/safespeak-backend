import { Router } from 'express';

import { aiRoutes } from '@modules/ai/ai.routes';
import { authRoutes } from '@modules/auth/auth.routes';
import { consentRoutes } from '@modules/consent/consent.routes';
import { evidenceRoutes } from '@modules/evidence/evidence.routes';
import { healthRoutes } from '@modules/health/health.routes';
import { profileRoutes } from '@modules/profile/profile.routes';
import { ragRoutes } from '@modules/rag/rag.routes';
import { reportsRoutes } from '@modules/reports/reports.routes';
import { sessionsRoutes } from '@modules/sessions/sessions.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/sessions', sessionsRoutes);
apiRouter.use('/consents', consentRoutes);
apiRouter.use('/', profileRoutes);
apiRouter.use('/reports', reportsRoutes);
apiRouter.use('/', evidenceRoutes);
apiRouter.use('/ai', aiRoutes);
apiRouter.use('/rag', ragRoutes);
