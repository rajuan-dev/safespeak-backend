import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { transcribeWithAiAgent } from './ai-agent.client';

export interface TranscriptionResult {
  transcript: string;
  language?: string;
  durationSeconds?: number;
  provider: 'openai';
  model: string;
}

export interface TranscriptionInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  language?: string;
}

export const SUPPORTED_TRANSCRIPTION_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'video/mp4',
  'video/webm'
]);

export const assertSupportedTranscriptionMimeType = (mimeType: string): void => {
  if (!SUPPORTED_TRANSCRIPTION_MIME_TYPES.has(mimeType)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Unsupported audio/video file type for transcription'
    );
  }
};

export const transcribeAudioBuffer = async (
  input: TranscriptionInput
): Promise<TranscriptionResult> => {
  assertSupportedTranscriptionMimeType(input.mimeType);
  return transcribeWithAiAgent(input);
};
