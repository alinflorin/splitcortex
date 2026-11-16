import { describe, expect, it, vi } from 'vitest';
import type { NativeApi } from '../native/ipc';
import { DEFAULT_CONTEXT, NativeEngine } from './native';

function fakeApi(over: Partial<NativeApi> = {}): NativeApi {
  return {
    engineLoad: vi.fn(async (_n, backend, ctx) => ({ backend, maxContextTokens: ctx })),
    engineUnload: vi.fn(async () => undefined),
    engineGenerate: vi.fn(async (_req, onText) => {
      ['Hel', 'lo'].forEach(onText);
    }),
    engineCancel: vi.fn(async () => undefined),
    engineCaps: vi.fn(async () => ({ gpuAvailable: true, emulator: false, totalMemoryMb: 16384 })),
    ...over,
  } as unknown as NativeApi;
}

const req = {
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hi' },
  ],
  maxTokens: 0,
  temperature: 0,
  topP: 0,
};

describe('NativeEngine', () => {
  it('loads with the asked backend and context, defaults otherwise', async () => {
    const api = fakeApi();
    const e = new NativeEngine(api);
    await e.load('m.litertlm');
    expect(api.engineLoad).toHaveBeenCalledWith('m.litertlm', 'cpu', DEFAULT_CONTEXT, false);
    expect(e.loaded).toBe(true);
    await e.load('m.litertlm', { backend: 'gpu', maxContextTokens: 8192, enableMtp: true });
    expect(api.engineLoad).toHaveBeenLastCalledWith('m.litertlm', 'gpu', 8192, true);
    expect(e.backend).toBe('gpu');
    expect(e.maxContextTokens).toBe(8192);
    await e.unload();
    expect(e.loaded).toBe(false);
    expect(e.backend).toBeNull();
  });

  it('streams text pieces and reports why it stopped', async () => {
    const e = new NativeEngine(fakeApi());
    await e.load('m');
    const got: string[] = [];
    const r = await e.generate(req, (t) => got.push(t), new AbortController().signal);
    expect(got.join('')).toBe('Hello');
    expect(r.finishReason).toBe('stop');
    const limited = await e.generate(
      { ...req, maxTokens: 2 },
      () => undefined,
      new AbortController().signal,
    );
    expect(limited.finishReason).toBe('length');
  });

  it('cancels natively when the signal aborts, and drops late text', async () => {
    let emit: (t: string) => void = () => undefined;
    let finish: () => void = () => undefined;
    const api = fakeApi({
      engineGenerate: vi.fn(
        (_r, onText) =>
          new Promise<void>((resolve) => {
            emit = onText;
            finish = resolve;
          }),
      ),
    });
    const e = new NativeEngine(api);
    await e.load('m');
    const ctl = new AbortController();
    const got: string[] = [];
    const run = e.generate(req, (t) => got.push(t), ctl.signal);
    emit('a');
    ctl.abort();
    emit('late');
    finish();
    await run;
    expect(got).toEqual(['a']);
    expect(api.engineCancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a second generation while one runs, and one without a model', async () => {
    const api = fakeApi({ engineGenerate: vi.fn(() => new Promise<void>(() => undefined)) });
    const e = new NativeEngine(api);
    await expect(e.generate(req, () => undefined, new AbortController().signal)).rejects.toThrow(
      'No model',
    );
    await e.load('m');
    void e.generate(req, () => undefined, new AbortController().signal);
    await expect(e.generate(req, () => undefined, new AbortController().signal)).rejects.toThrow(
      'busy',
    );
  });

  it('falls back to "no GPU" when the capability probe fails', async () => {
    const e = new NativeEngine(
      fakeApi({ engineCaps: vi.fn(async () => Promise.reject(new Error('x'))) }),
    );
    expect(await e.capabilities()).toEqual({
      gpuAvailable: false,
      emulator: false,
      totalMemoryMb: 0,
    });
  });

  it('measures decode speed from the pieces of a short generation', async () => {
    let t = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 100));
    const e = new NativeEngine(
      fakeApi({
        engineGenerate: vi.fn(async (_r, onText) => {
          for (let i = 0; i < 5; i++) onText('x');
        }),
      }),
    );
    await e.load('m');
    // 5 pieces, 100 ms apart: 4 intervals in 400 ms = 10 tokens/s
    expect(await e.benchmark()).toBeCloseTo(10);
    vi.restoreAllMocks();
  });
});
