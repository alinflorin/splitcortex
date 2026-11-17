import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayError, listModels, streamChat } from './chatStream';

const sse = (...lines: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
const chunk = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

afterEach(() => vi.unstubAllGlobals());

describe('listModels', () => {
  it('sends the key as a bearer token and returns the models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'gemma' }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await listModels('/v1', 'sc_x')).toEqual([{ id: 'gemma' }]);
    expect(fetchMock.mock.calls[0]?.[1].headers.Authorization).toBe('Bearer sc_x');
  });

  it('surfaces the OpenAI error message and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }),
        ),
    );
    await expect(listModels('/v1', 'bad')).rejects.toMatchObject({
      message: 'Invalid API key',
      status: 401,
    });
  });
});

describe('streamChat', () => {
  it('reassembles pieces split across reads and counts them', async () => {
    const half = chunk('Hel');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(sse(half.slice(0, 10), half.slice(10), chunk('lo'), 'data: [DONE]\n\n')),
    );
    const got: string[] = [];
    const stats = await streamChat('/v1', 'k', { model: 'm', messages: [] }, (d) => got.push(d));
    expect(got.join('')).toBe('Hello');
    expect(stats.tokens).toBe(2);
    expect(stats.firstTokenMs).not.toBeNull();
  });

  it('sends only the options that are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    await streamChat('/v1', 'k', { model: 'm', messages: [], maxTokens: 5 }, () => {});
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'm', stream: true, max_tokens: 5 });
    expect(body).not.toHaveProperty('temperature');
  });

  it('throws a mid-stream error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sse(chunk('a'), 'data: {"error":{"message":"node lost"}}\n\n')),
    );
    await expect(
      streamChat('/v1', 'k', { model: 'm', messages: [] }, () => {}),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it('resolves with what arrived when aborted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    const stats = await streamChat('/v1', 'k', { model: 'm', messages: [] }, () => {});
    expect(stats.tokens).toBe(0);
  });
});
