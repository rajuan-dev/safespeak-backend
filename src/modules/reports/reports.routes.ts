import { Router } from 'express';

import { authenticateSessionOrUser } from '@common/middleware/auth.middleware';
import { validate } from '@common/middleware/validate.middleware';

import {
  acknowledgeReportSubmissionController,
  createReportController,
  deleteReportController,
  getReportDestinationPreviewsController,
  getReportController,
  getReportStatusController,
  getReportTimelineController,
  listReportSubmissionsController,
  listReportsController,
  markInfoOnlyController,
  requestDeleteController,
  submitReportController,
  updateReportController,
  withdrawReportController
} from './reports.controller';
import {
  acknowledgeSubmissionSchema,
  createReportSchema,
  reportDestinationPreviewQuerySchema,
  reportParamsSchema,
  submissionParamsSchema,
  submitReportSchema,
  updateReportSchema
} from './reports.schema';

export const reportsRoutes = Router();

reportsRoutes.use(authenticateSessionOrUser);
reportsRoutes.post('/', validate({ body: createReportSchema }), createReportController);
reportsRoutes.get('/', listReportsController);
reportsRoutes.get('/:id', validate({ params: reportParamsSchema }), getReportController);
reportsRoutes.patch(
  '/:id',
  validate({ params: reportParamsSchema, body: updateReportSchema }),
  updateReportController
);
reportsRoutes.delete('/:id', validate({ params: reportParamsSchema }), deleteReportController);
reportsRoutes.post(
  '/:id/mark-info-only',
  validate({ params: reportParamsSchema }),
  markInfoOnlyController
);
reportsRoutes.post(
  '/:id/withdraw',
  validate({ params: reportParamsSchema }),
  withdrawReportController
);
reportsRoutes.post(
  '/:id/request-delete',
  validate({ params: reportParamsSchema }),
  requestDeleteController
);
reportsRoutes.get(
  '/:id/status',
  validate({ params: reportParamsSchema }),
  getReportStatusController
);
reportsRoutes.get(
  '/:id/timeline',
  validate({ params: reportParamsSchema }),
  getReportTimelineController
);
reportsRoutes.get(
  '/:id/destinations',
  validate({ params: reportParamsSchema, query: reportDestinationPreviewQuerySchema }),
  getReportDestinationPreviewsController
);
reportsRoutes.get(
  '/:id/submissions',
  validate({ params: reportParamsSchema }),
  listReportSubmissionsController
);
reportsRoutes.post(
  '/:id/submissions',
  validate({ params: reportParamsSchema, body: submitReportSchema }),
  submitReportController
);
reportsRoutes.post(
  '/:id/submissions/:submissionId/acknowledge',
  validate({ params: submissionParamsSchema, body: acknowledgeSubmissionSchema }),
  acknowledgeReportSubmissionController
);
