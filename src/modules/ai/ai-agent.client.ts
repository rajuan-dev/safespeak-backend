import { StatusCodes } from 'http-status-codes';

import { ApiError } from '@common/errors/ApiError';
import { env } from '@config/env';

type AgentEnvelope<T> = { success?: boolean; message?: string; data?: T };

const agentUrl = (path: string): string =>
  `${env.AI_AGENT_BASE_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const createDirectOpenAiEmbeddings = async (
  texts: string[],
  model?: string
): Promise<number[][]> => {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'SafeSpeak AI agent request failed');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      input: texts,
      model
    })
  }).catch(() => {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI embeddings request failed');
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: Array<{ embedding?: number[] }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status >= 500 ? StatusCodes.BAD_GATEWAY : response.status,
      payload?.error?.message ?? 'OpenAI embeddings request failed'
    );
  }

  const embeddings = Array.isArray(payload?.data)
    ? payload.data.map((item) => item.embedding).filter((value): value is number[] => Array.isArray(value))
    : [];

  if (embeddings.length !== texts.length) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'OpenAI returned invalid embeddings');
  }

  return embeddings;
};

const callAgent = async <T>(path: string, body: unknown): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.AI_AGENT_INTERNAL_TOKEN) headers['X-AI-Agent-Token'] = env.AI_AGENT_INTERNAL_TOKEN;

  let response: Response;
  try {
    response = await fetch(agentUrl(path), {
      method: 'POST', headers, body: JSON.stringify(body)
    });
  } catch {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'SafeSpeak AI agent is unavailable');
  }

  const payload = (await response.json().catch(() => null)) as AgentEnvelope<T> | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new ApiError(
      response.status >= 500 ? StatusCodes.BAD_GATEWAY : response.status,
      payload?.message ?? 'SafeSpeak AI agent request failed'
    );
  }
  return payload.data;
};

const callAgentFormData = async <T>(path: string, formData: FormData): Promise<T> => {
  const headers: Record<string, string> = {};
  if (env.AI_AGENT_INTERNAL_TOKEN) headers['X-AI-Agent-Token'] = env.AI_AGENT_INTERNAL_TOKEN;

  let response: Response;
  try {
    response = await fetch(agentUrl(path), { method: 'POST', headers, body: formData });
  } catch {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'SafeSpeak AI agent is unavailable');
  }

  const payload = (await response.json().catch(() => null)) as AgentEnvelope<T> | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new ApiError(
      response.status >= 500 ? StatusCodes.BAD_GATEWAY : response.status,
      payload?.message ?? 'SafeSpeak AI agent request failed'
    );
  }
  return payload.data;
};

export const callAiAgentText = async (input: {
  systemPrompt: string; userPrompt: string; model?: string; temperature?: number;
}): Promise<string> => {
  const result = await callAgent<{ text?: string }>('/internal/ai/complete', {
    ...input, temperature: input.temperature ?? 0.2
  });
  return result.text?.trim() ?? '';
};

export const callAiAgentJson = async <T>(input: {
  systemPrompt: string; userPrompt: string; model?: string; temperature?: number;
}): Promise<T> => {
  const result = await callAgent<{ result?: T }>('/internal/ai/complete-json', {
    ...input, temperature: input.temperature ?? 0.2
  });
  return (result.result ?? {}) as T;
};

export const createAiAgentEmbeddings = async (texts: string[], model?: string): Promise<number[][]> => {
  if (texts.length === 0) return [];

  try {
    const result = await callAgent<{ embeddings?: number[][] }>('/internal/ai/embeddings', { texts, model });
    if (!result.embeddings || result.embeddings.length !== texts.length) {
      throw new ApiError(StatusCodes.BAD_GATEWAY, 'SafeSpeak AI agent returned invalid embeddings');
    }
    return result.embeddings;
  } catch (error) {
    if (!env.OPENAI_API_KEY) {
      throw error;
    }

    return createDirectOpenAiEmbeddings(texts, model ?? env.OPENAI_EMBEDDING_MODEL);
  }
};

export const transcribeWithAiAgent = async (input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  language?: string;
}): Promise<{ transcript: string; language?: string; durationSeconds?: number; provider: 'openai'; model: string }> => {
  const formData = new FormData();
  formData.set('audio', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.fileName);
  if (input.language) formData.set('language', input.language);
  return callAgentFormData('/internal/ai/transcribe', formData);
};

export const synthesizeWithAiAgent = async (input: {
  text: string;
  voice?: string;
}): Promise<{ audioBase64: string; mimeType: string; model: string; voice: string; temporary: boolean }> =>
  callAgent('/internal/ai/synthesize', input);

export const callAiAgentVisionText = async (input: {
  instruction: string;
  imageData: string;
  model?: string;
}): Promise<string> => {
  const result = await callAgent<{ text?: string }>('/internal/ai/vision-text', input);
  return result.text?.trim() ?? '';
};
