import { describe, expect, it, vi } from 'vitest';
import { LiteRtEmbedder, type LiteEmbeddingModule } from './litert-embedder';
import type { Backend } from './types';

type Settings = { backend?: number; maxInputLength?: number; minInputLength?: number };
const CPU = 1;
const GPU = 2;

/**
 * A fake library whose model has a 512-token window. `gpu` shapes what the GPU backend does: 'nan', 'wrong' (finite
 * but different vectors) or 'ok'. The clock advances 10 per CPU batch and 1 per GPU batch.
 */
function fakeLib(opts: { gpu?: 'nan' | 'wrong' | 'ok'; inputLength?: number } = {}) {
  const created: Settings[] = [];
  const clock = { t: 0 };
  const mod = {
    loadLiteRtLm: vi.fn(async () => undefined),
    Backend: { CPU, GPU },
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
          computeEmbeddingBatch: async (inputs: string[]) => {
            clock.t += s.backend === GPU ? 1 : 10;
            return inputs.map(() => ({
              embedding:
                s.backend !== GPU || opts.gpu === 'ok'
                  ? [0.6, 0.8]
                  : opts.gpu === 'nan'
                    ? [NaN, 0.5]
                    : [0.8, -0.6],
              inputLength: opts.inputLength ?? 3,
            }));
          },
          delete: async () => undefined,
        };
      }),
    },
  } as unknown as LiteEmbeddingModule;
  return { mod, created, clock };
}

const make = (
  lib: ReturnType<typeof fakeLib>,
  o: { pref?: Backend; gpuAvailable?: boolean; emulator?: boolean } = {},
) => {
  const store: Record<string, string> = {};
  const e = new LiteRtEmbedder({
    openModel: async () => new Blob(['x']),
    loadModule: async () => lib.mod,
    backend: () => o.pref,
    capabilities: async () => ({ gpuAvailable: !!o.gpuAvailable, emulator: !!o.emulator }),
    cache: {
      get: async (k) => store[k] as Backend | undefined,
      set: async (k, v) => void (store[k] = v),
    },
    now: () => lib.clock.t,
  });
  return { e, store };
};
const last = (lib: ReturnType<typeof fakeLib>) => lib.created.at(-1)?.backend;

describe('LiteRtEmbedder', () => {
  it('uses the window the file allows and prepares a shorter signature next to it', async () => {
    const lib = fakeLib();
    const { e } = make(lib);
    await e.load('m');
    expect(lib.created.at(-1)).toMatchObject({ maxInputLength: 512, minInputLength: 64 });
    expect(e.dimension).toBe(2);
  });

  it('follows the backend setting: CPU is the CPU, and GPU is the GPU when the device has one', async () => {
    const a = fakeLib({ gpu: 'ok' });
    await make(a, { pref: 'cpu', gpuAvailable: true }).e.load('m');
    expect(last(a)).toBe(CPU);
    const b = fakeLib({ gpu: 'ok' });
    await make(b, { pref: 'gpu', gpuAvailable: true }).e.load('m');
    expect(last(b)).toBe(GPU);
    const c = fakeLib({ gpu: 'ok' });
    await make(c, { pref: 'gpu', gpuAvailable: false }).e.load('m');
    expect(last(c)).toBe(CPU);
  });

  it('falls back to the CPU when an asked-for GPU gives NaN, and refuses NaN on the CPU', async () => {
    const lib = fakeLib({ gpu: 'nan' });
    await make(lib, { pref: 'gpu', gpuAvailable: true }).e.load('m');
    expect(last(lib)).toBe(CPU);
    const bad = fakeLib();
    bad.mod.EmbeddingEngine.create = async () =>
      ({
        computeEmbeddingBatch: async () => [{ embedding: [NaN], inputLength: 1 }],
        delete: async () => undefined,
      }) as never;
    await expect(make(bad).e.load('m')).rejects.toThrow(/NaN/);
  });

  it('automatic: takes the GPU when it gives the same vectors and is clearly faster, and remembers it', async () => {
    const lib = fakeLib({ gpu: 'ok' });
    const { e, store } = make(lib, { gpuAvailable: true });
    await e.load('m');
    expect(last(lib)).toBe(GPU);
    expect(store['embed:m']).toBe('gpu');
  });

  it('automatic: keeps the CPU when the GPU computes different vectors', async () => {
    const lib = fakeLib({ gpu: 'wrong' });
    const { e, store } = make(lib, { gpuAvailable: true });
    await e.load('m');
    expect(last(lib)).toBe(CPU);
    expect(store['embed:m']).toBe('cpu');
  });

  it('automatic: no GPU, or an emulator, means the CPU without measuring', async () => {
    const a = fakeLib({ gpu: 'ok' });
    await make(a).e.load('m');
    expect(a.created).toHaveLength(1);
    const b = fakeLib({ gpu: 'ok' });
    await make(b, { gpuAvailable: true, emulator: true }).e.load('m');
    expect(last(b)).toBe(CPU);
    expect(b.created).toHaveLength(1);
  });

  it('reloads on a changed backend setting only', async () => {
    const lib = fakeLib({ gpu: 'ok' });
    let pref: Backend | undefined = 'cpu';
    const e = new LiteRtEmbedder({
      openModel: async () => new Blob(['x']),
      loadModule: async () => lib.mod,
      backend: () => pref,
      capabilities: async () => ({ gpuAvailable: true, emulator: false }),
    });
    await e.load('m');
    await e.reapply();
    expect(lib.created).toHaveLength(1);
    pref = 'gpu';
    await e.reapply();
    expect(lib.created).toHaveLength(2);
    expect(last(lib)).toBe(GPU);
  });

  it('fails an input longer than the window instead of returning a chunked vector', async () => {
    const lib = fakeLib({ inputLength: 3001 });
    const { e } = make(lib);
    await e.load('m');
    await expect(e.embed(['long'])).rejects.toThrow(/longer than/);
  });
});
