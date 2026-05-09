import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';

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
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'OPENAI_API_KEY is not configured');
  }

  assertSupportedTranscriptionMimeType(input.mimeType);

  const formData = new FormData();
  const file = new File([new Uint8Array(input.buffer)], input.fileName || 'audio-input.webm', {
    type: input.mimeType
  });

  formData.set('file', file);
  formData.set('model', env.OPENAI_TRANSCRIPTION_MODEL);
  if (input.language) {
    formData.set('language', input.language);
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI transcription request failed');
  }

  const payload = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
  };

  if (!payload.text) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI transcription response was empty');
  }

  return {
    transcript: payload.text,
    language: payload.language,
    durationSeconds: payload.duration,
    provider: 'openai',
    model: env.OPENAI_TRANSCRIPTION_MODEL
  };
};
