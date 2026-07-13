import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { getCurrentConsent } from '@modules/consent/consent.service';

import type { RagOwner } from './rag.types';

export const assertRagAiConsent = async (owner: RagOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai consent is required for AI processing'
    );
  }
};
