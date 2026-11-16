import { ComputeEngine, GPU_MARGIN, autoContext, type BenchCache } from './compute';
import type { Backend, ComputePrefs, DeviceCaps, Engine } from './types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

/** A fake engine: remembers what it was loaded with; speed per backend is configurable, a backend can be broken. */
function fakeEngine(
  caps: Partial<DeviceCaps>,
  speed: Record<Backend, number>,
  broken: Backend[] = [],
  noDrafter = false,
) {
  const loads: { backend?: Backend; ctx?: number }[] = [];
  const mtp: boolean[] = [];
  let active: { backend: Backend; ctx: number } | null = null;
  const e: Engine = {
    get loaded() {
      return active !== null;
    },
    get backend() {
      return active?.backend ?? null;
    },
    get maxContextTokens() {
      return active?.ctx ?? 0;
    },
    capabilities: () => ({ gpuAvailable: true, emulator: false, totalMemoryMb: 8000, ...caps }),
    async load(_path: string, o: ComputePrefs = {}) {
      if (o.backend && broken.includes(o.backend)) throw new Error(`${o.backend} broke`);
      if (o.enableMtp && noDrafter) throw new Error('no drafter in this bundle');
      loads.push({ backend: o.backend, ctx: o.maxContextTokens });
      mtp.push(o.enableMtp === true);
      active = { backend: o.backend ?? 'cpu', ctx: o.maxContextTokens ?? 4096 };
    },
    async unload() {
      active = null;
    },
    benchmark: async () => speed[active!.backend],
    generate: jest.fn(async () => ({ finishReason: 'stop' as const })),
  };
  return { e, loads, mtp };
}
const memCache = (): BenchCache & { map: Map<string, Backend> } => {
  const map = new Map<string, Backend>();
  return { map, get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v) };
};

describe('autoContext', () => {
  it('follows the RAM, and falls back to the library default when it is unknown', () => {
    expect([0, 3000, 6000, 12000].map(autoContext)).toEqual([4096, 2048, 4096, 8192]);
  });
});

describe('ComputeEngine', () => {
  it('measures CPU and GPU once, takes the clearly faster one and remembers it', async () => {
    const { e, loads } = fakeEngine({}, { cpu: 10, gpu: 10 * GPU_MARGIN * 2 });
    const cache = memCache();
    const c = new ComputeEngine(e, cache);
    await c.load('/m/a.litertlm');
    expect(c.backend).toBe('gpu');
    expect(cache.map.get('/m/a.litertlm')).toBe('gpu');
    const first = loads.length;
    // a second engine on the same device uses the remembered answer: no benchmark loads
    const again = fakeEngine({}, { cpu: 99, gpu: 1 });
    const c2 = new ComputeEngine(again.e, cache);
    await c2.load('/m/a.litertlm');
    expect(c2.backend).toBe('gpu');
    expect(again.loads).toHaveLength(1);
    expect(first).toBeGreaterThan(1);
  });

  it('keeps the CPU when the GPU is not clearly faster, or cannot load', async () => {
    const close = fakeEngine({}, { cpu: 10, gpu: 10.5 });
    const a = new ComputeEngine(close.e, memCache());
    await a.load('/m/a');
    expect(a.backend).toBe('cpu');
    const broken = fakeEngine({}, { cpu: 10, gpu: 50 }, ['gpu']);
    const b = new ComputeEngine(broken.e, memCache());
    await b.load('/m/b');
    expect(b.backend).toBe('cpu');
  });

  it('never benchmarks on an emulator or without a GPU driver', async () => {
    for (const caps of [{ emulator: true }, { gpuAvailable: false }]) {
      const { e, loads } = fakeEngine(caps, { cpu: 1, gpu: 100 });
      const c = new ComputeEngine(e, memCache());
      await c.load('/m/a');
      expect(c.backend).toBe('cpu');
      expect(loads).toHaveLength(1);
    }
  });

  it('applies the admin override over the local setting, per field, and reloads only on a change', async () => {
    const { e, loads } = fakeEngine({}, { cpu: 10, gpu: 50 });
    const c = new ComputeEngine(e, memCache());
    await c.setPrefs('local', { backend: 'gpu', maxContextTokens: 8192 });
    await c.load('/m/a');
    expect(loads.at(-1)).toEqual({ backend: 'gpu', ctx: 8192 });
    const n = loads.length;
    await c.setPrefs('local', { backend: 'gpu', maxContextTokens: 8192 });
    expect(loads).toHaveLength(n); // same effective settings: no reload
    await c.setPrefs('admin', { backend: 'cpu' });
    expect(loads.at(-1)).toEqual({ backend: 'cpu', ctx: 8192 }); // backend from the admin, context from the device
    expect(c.backend).toBe('cpu');
    await c.setPrefs('admin', {});
    expect(c.backend).toBe('gpu'); // clearing the override returns to the local setting
  });

  it('turns on multi-token prediction by the setting, the admin wins, and it is dropped when the bundle cannot run it', async () => {
    const { e, mtp } = fakeEngine({}, { cpu: 1, gpu: 1 });
    const c = new ComputeEngine(e, memCache());
    await c.setPrefs('local', { backend: 'cpu', enableMtp: true });
    await c.load('/m/a');
    expect(mtp.at(-1)).toBe(true);
    await c.setPrefs('admin', { enableMtp: false });
    expect(mtp.at(-1)).toBe(false); // the admin override reloads without it
    await c.setPrefs('admin', {});
    expect(mtp.at(-1)).toBe(true);

    const plain = fakeEngine({}, { cpu: 1, gpu: 1 }, [], true);
    const d = new ComputeEngine(plain.e, memCache());
    await d.setPrefs('local', { backend: 'cpu', enableMtp: true });
    await d.load('/m/b'); // the first attempt throws, the second loads without MTP
    expect(plain.mtp).toEqual([false]);
    expect(d.loaded).toBe(true);
  });

  it('does not reload when nothing is loaded yet', async () => {
    const { e, loads } = fakeEngine({}, { cpu: 1, gpu: 1 });
    const c = new ComputeEngine(e, memCache());
    await c.setPrefs('admin', { backend: 'cpu' });
    expect(loads).toHaveLength(0);
  });

  it('uses the CPU when the GPU is forced but there is no driver, and steps back when a load fails', async () => {
    const none = fakeEngine({ gpuAvailable: false }, { cpu: 1, gpu: 1 });
    const a = new ComputeEngine(none.e, memCache());
    await a.setPrefs('admin', { backend: 'gpu' });
    await a.load('/m/a');
    expect(a.backend).toBe('cpu');
    const flaky = fakeEngine({}, { cpu: 1, gpu: 1 }, ['gpu']);
    const b = new ComputeEngine(flaky.e, memCache());
    await b.setPrefs('admin', { backend: 'gpu', maxContextTokens: 2048 });
    await b.load('/m/b');
    expect(b.backend).toBe('cpu');
    expect(b.maxContextTokens).toBe(2048);
  });
});
