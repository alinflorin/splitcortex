import { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatStats {
  /** Milliseconds until the first streamed piece. */
  firstTokenMs: number | null;
  totalMs: number;
  /** Streamed pieces (the gateway counts one completion token per piece too). */
  tokens: number;
}

/** A failed call: an HTTP status plus the OpenAI-shaped message, when there is one. */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const modelsSchema = z.object({
  data: z.array(z.object({ id: z.string(), context_length: z.number().nullish() })),
});
const errorSchema = z.object({ error: z.object({ message: z.string() }) });
const chunkSchema = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string().nullish() }).nullish() })),
});

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
});

async function failure(res: Response): Promise<GatewayError> {
  const parsed = errorSchema.safeParse(await res.json().catch(() => null));
  return new GatewayError(parsed.success ? parsed.data.error.message : res.statusText, res.status);
}

/** `GET /v1/models`: the models the key can use (its pools' models). */
export async function listModels(baseUrl: string, key: string, signal?: AbortSignal) {
  const res = await fetch(`${baseUrl}/models`, { headers: headers(key), signal });
  if (!res.ok) throw await failure(res);
  return modelsSchema.parse(await res.json()).data;
}

/**
 * `POST /v1/chat/completions` with `stream: true`, calling `onDelta` for each piece of the reply. Resolves with timing
 * once the stream ends; aborting `signal` stops the request (the gateway cancels the node) and resolves with what
 * arrived. Nothing is stored or logged here.
 */
export async function streamChat(
  baseUrl: string,
  key: string,
  params: ChatParams,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatStats> {
  const started = performance.now();
  const stats: ChatStats = { firstTokenMs: null, totalMs: 0, tokens: 0 };
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(key),
      signal,
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: true,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.maxTokens !== undefined && { max_tokens: params.maxTokens }),
      }),
    });
    if (!res.ok) throw await failure(res);
    if (!res.body) throw new GatewayError('Empty response');

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trimEnd();
        buffer = buffer.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        // A mid-stream failure arrives as an error event; the gateway does not restart silently.
        const err = errorSchema.safeParse(json);
        if (err.success) throw new GatewayError(err.data.error.message);
        const chunk = chunkSchema.safeParse(json);
        const text = chunk.success ? chunk.data.choices[0]?.delta?.content : undefined;
        if (text) {
          stats.firstTokenMs ??= performance.now() - started;
          stats.tokens += 1;
          onDelta(text);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
  } finally {
    stats.totalMs = performance.now() - started;
  }
  return stats;
}
