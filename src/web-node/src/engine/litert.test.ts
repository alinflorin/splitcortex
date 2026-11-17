import { describe, expect, it, vi } from 'vitest';
import { LiteRtEngine, WASM_PATH, type LiteModule } from './litert';

/** A fake `@litert-lm/core`: records what it was asked and streams the given pieces. */
function fakeModule(pieces: string[] = ['Hel', 'lo'], textOnly = false) {
  const calls = {
    wasm: [] as string[],
    create: [] as unknown[],
    conv: [] as unknown[],
    sent: [] as unknown[],
    cancelled: 0,
    deleted: 0,
  };
  const mod: LiteModule = {
    Backend: { CPU: 3, GPU: 4 },
    SamplerType: { TOP_P: 7 },
    loadLiteRtLm: async (path) => void calls.wasm.push(path),
    Engine: {
      create: async (settings) => {
        calls.create.push(settings);
        if (
          textOnly &&
          (settings.visionBackend !== undefined || settings.audioBackend !== undefined)
        )
          throw new Error('this model has no encoders');
        return {
          createConversation: async (config) => {
            calls.conv.push(config);
            return {
              sendMessageStreaming: (m) => {
                calls.sent.push(m);
                return (async function* () {
                  for (const text of pieces) yield { content: [{ type: 'text', text }] };
                })();
              },
              cancel: () => void calls.cancelled++,
              delete: async () => void calls.deleted++,
            };
          },
          delete: async () => undefined,
        };
      },
    },
  };
  return { mod, calls };
}

const nav = {
  gpu: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
  deviceMemory: 8,
};

function engine(mod: LiteModule) {
  const openModel = vi.fn(async () => new Blob(['x']));
  return {
    e: new LiteRtEngine({ openModel, loadModule: async () => mod, nav }),
    openModel,
  };
}

describe('LiteRtEngine', () => {
  it('loads the WASM runtime from this origin, never from a CDN, and the model as a Blob', async () => {
    const { mod, calls } = fakeModule();
    const { e, openModel } = engine(mod);
    await e.load('m1.litertlm', { backend: 'gpu', maxContextTokens: 2048 });
    expect(calls.wasm).toEqual([`${location.origin}${WASM_PATH}`]);
    expect(calls.wasm[0]).not.toMatch(/jsdelivr/);
    expect(openModel).toHaveBeenCalledWith('m1.litertlm');
    expect(calls.create[0]).toMatchObject({
      backend: 4,
      mainExecutorSettings: { maxNumTokens: 2048 },
    });
    expect(e).toMatchObject({ loaded: true, backend: 'gpu', maxContextTokens: 2048 });
    await e.unload();
    expect(e.loaded).toBe(false);
  });

  it('enables image and audio input when the model has the encoders, and falls back to text only', async () => {
    const full = fakeModule();
    const a = engine(full.mod).e;
    await a.load('m1.litertlm');
    expect(a.modalities).toEqual(['image', 'audio']);
    expect(full.calls.create[0]).toMatchObject({ visionBackend: 3, audioBackend: 3 });
    await a.unload();
    expect(a.modalities).toEqual([]);

    const plain = fakeModule(undefined, true);
    const b = engine(plain.mod).e;
    await b.load('m2.litertlm');
    expect(b.modalities).toEqual([]);
    expect(plain.calls.create).toHaveLength(2);
    expect(plain.calls.create[1]).not.toHaveProperty('visionBackend');
    expect(b.loaded).toBe(true);
  });

  it('sends messages with media as typed parts', async () => {
    const { mod, calls } = fakeModule();
    const { e } = engine(mod);
    await e.load('m1.litertlm');
    const png = new Uint8Array([1, 2, 3]);
    const wav = new Uint8Array([4, 5]);
    await e.generate(
      {
        messages: [
          { role: 'user', content: 'earlier' },
          {
            role: 'user',
            content: 'What is this?',
            parts: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', mimeType: 'image/png', data: png },
              { type: 'audio', mimeType: 'audio/wav', data: wav },
            ],
          },
        ],
        maxTokens: 0,
        temperature: 0,
        topP: 0,
      },
      () => undefined,
      new AbortController().signal,
    );
    expect(calls.sent).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', data: png },
          { type: 'audio', data: wav },
        ],
      },
    ]);
  });

  it('reports WebGPU and the device memory as capabilities', async () => {
    const { e } = engine(fakeModule().mod);
    expect(await e.capabilities()).toEqual({
      gpuAvailable: true,
      emulator: false,
      totalMemoryMb: 8192,
    });
    const none = new LiteRtEngine({ openModel: async () => new Blob(), nav: {} });
    expect((await none.capabilities()).gpuAvailable).toBe(false);
  });

  it('sends the history as the preface and streams the last turn', async () => {
    const { mod, calls } = fakeModule();
    const { e } = engine(mod);
    await e.load('m1.litertlm');
    const out: string[] = [];
    const result = await e.generate(
      {
        messages: [
          { role: 'system', content: 'Be brief' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'Bye?' },
        ],
        maxTokens: 2,
        temperature: 0.5,
        topP: 0.9,
      },
      (t) => out.push(t),
      new AbortController().signal,
    );
    expect(out).toEqual(['Hel', 'lo']);
    expect(result.finishReason).toBe('length'); // two pieces against a limit of two
    expect(calls.sent).toEqual([{ role: 'user', content: 'Bye?' }]);
    expect(calls.conv.at(-1)).toMatchObject({
      preface: {
        messages: [
          { role: 'system', content: 'Be brief' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
      },
      sessionConfig: { maxOutputTokens: 2, samplerParams: { type: 7, temperature: 0.5, p: 0.9 } },
    });
    expect(calls.deleted).toBe(1);
  });

  it('cancels the generation when aborted and refuses to run without a model', async () => {
    const { mod, calls } = fakeModule(['a', 'b', 'c']);
    const { e } = engine(mod);
    await expect(
      e.generate(
        { messages: [], maxTokens: 0, temperature: 0, topP: 0 },
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow('No model');
    await e.load('m1.litertlm');
    const ctl = new AbortController();
    const out: string[] = [];
    await e.generate(
      { messages: [{ role: 'user', content: 'x' }], maxTokens: 0, temperature: 0, topP: 0 },
      (t) => {
        out.push(t);
        ctl.abort();
      },
      ctl.signal,
    );
    expect(out).toEqual(['a']);
    expect(calls.cancelled).toBe(1);
  });
});
