import { gatewayUrl } from '../env.ts';

export interface StreamResult {
  status: number;
  /** ms from sending the request to the first piece of text. */
  ttftMs: number | null;
  /** ms between consecutive pieces. */
  gapsMs: number[];
  totalMs: number;
  pieces: number;
  done: boolean;
}

/** One streaming chat completion through the gateway, timed piece by piece. Never throws on an HTTP error status. */
export async function timedStream(
  key: string,
  model: string,
  maxTokens: number,
): Promise<StreamResult> {
  const t0 = performance.now();
  const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: 'Say hello.' }],
    }),
  });
  const out: StreamResult = {
    status: res.status,
    ttftMs: null,
    gapsMs: [],
    totalMs: 0,
    pieces: 0,
    done: false,
  };
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    out.totalMs = performance.now() - t0;
    return out;
  }
  let last = 0;
  let buf = '';
  const decoder = new TextDecoder();
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(part, { stream: true });
    let at: number;
    while ((at = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, at).trim();
      buf = buf.slice(at + 2);
      if (!event.startsWith('data:')) continue;
      const data = event.slice(5).trim();
      if (data === '[DONE]') {
        out.done = true;
        continue;
      }
      const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      if (!json.choices?.[0]?.delta?.content) continue;
      const now = performance.now();
      if (out.ttftMs === null) out.ttftMs = now - t0;
      else out.gapsMs.push(now - last);
      last = now;
      out.pieces += 1;
    }
  }
  out.totalMs = performance.now() - t0;
  return out;
}
