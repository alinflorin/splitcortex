import { describe, expect, it, vi } from 'vitest';
import { LiteRtEmbedder, type LiteEmbeddingModule } from './litert-embedder';

type Settings = { backend?: number; maxInputLength?: number; minInputLength?: number };

/** A fake library whose model has a 512-token window; `nanOn` makes a backend return NaN. */
function fakeLib(opts: { nanOn?: number; inputLength?: number } = {}) {
  const created: Settings[] = [];
  const mod = {
    loadLiteRtLm: vi.fn(async () => undefined),
    Backend: { CPU: 1, GPU: 2 },
    InputOverflowStrategy: { ERROR: 2 },
    EmbeddingEngine: {
      create: vi.fn(async (s: Settings & { model: Blob }) => {
        if ((s.maxInputLength ?? 1024) > 512)
          throw new Error(
            'Requested target capacity (' +
              s.maxInputLength +
              ') exceeds maximum available signature length (512).',
          );
        created.push(s);
        return {
          computeEmbeddingBatch: async (inputs: string[]) =>
            inputs.map(() => ({
              embedding: [s.backend === opts.nanOn ? NaN : 0.5, 0.5],
              inputLength: opts.inputLength ?? 3,
            })),
          delete: async () => undefined,
        };
      }),
    },
  } as unknown as LiteEmbeddingModule;
  return { mod, created };
}

const make = (mod: LiteEmbeddingModule, gpu = false) =>
  new LiteRtEmbedder({
    openModel: async () => new Blob(['x']),
    gpuAvailable: async () => gpu,
    loadModule: async () => mod,
  });

describe('LiteRtEmbedder', () => {
  it('uses the window the file allows and prepares a shorter signature next to it', async () => {
    const { mod, created } = fakeLib();
    const e = make(mod);
    await e.load('m');
    expect(created.at(-1)).toMatchObject({ maxInputLength: 512, minInputLength: 64 });
    expect(e.dimension).toBe(2);
  });

  it('drops a backend that yields NaN for the CPU, and refuses when the CPU does too', async () => {
    const { mod, created } = fakeLib({ nanOn: 2 });
    const e = make(mod, true);
    await e.load('m');
    expect(created.at(-1)?.backend).toBe(1);
    const bad = fakeLib({ nanOn: 1 });
    await expect(make(bad.mod).load('m')).rejects.toThrow(/NaN/);
  });

  it('fails an input longer than the window instead of returning a chunked vector', async () => {
    const { mod } = fakeLib({ inputLength: 3001 });
    const e = make(mod);
    await e.load('m');
    await expect(e.embed(['long'])).rejects.toThrow(/longer than/);
  });
});
