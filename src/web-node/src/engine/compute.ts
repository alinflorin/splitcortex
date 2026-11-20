import { DEFAULT_CONTEXT } from './litert';
import type {
  Backend,
  ComputePrefs,
  DeviceCaps,
  Engine,
  GenerateRequest,
  GenerateResult,
  TunableEngine,
} from './types';

/** Remembers which backend was measured faster for a model file on this device. */
export interface BenchCache {
  get(key: string): Promise<Backend | undefined>;
  set(key: string, backend: Backend): Promise<void>;
}

const BENCH_KEY = 'sc-node-backend-bench';
const readBench = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(BENCH_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};
export const storageBenchCache: BenchCache = {
  async get(key) {
    const v = readBench()[key];
    return v === 'cpu' || v === 'gpu' ? v : undefined;
  },
  async set(key, backend) {
    localStorage.setItem(BENCH_KEY, JSON.stringify({ ...readBench(), [key]: backend }));
  },
};

/** GPU must beat the CPU by this factor to be picked: below it, the CPU is steadier (less heat and power). */
export const GPU_MARGIN = 1.1;

/** Automatic context window from the device's RAM (the KV cache lives in it). Unknown RAM gets the library default. */
export function autoContext(totalMemoryMb: number): number {
  if (totalMemoryMb <= 0) return DEFAULT_CONTEXT;
  if (totalMemoryMb < 4096) return 2048;
  if (totalMemoryMb < 10240) return 4096;
  return 8192;
}

/**
 * Decides the engine's backend and context window and applies them. Per field, the admin's override (web app) wins,
 * then this app's own setting, then automatic: the backend is measured once per model on this device (CPU against
 * GPU, GPU only if clearly faster, never on an emulator or without a GPU driver) and remembered; the context window
 * follows the device's RAM. A failed load steps back (GPU to CPU, then the default window) instead of failing.
 */
export class ComputeEngine implements TunableEngine {
  private local: ComputePrefs = {};
  private admin: ComputePrefs = {};
  private path: string | null = null;
  private applied = '';
  private chain: Promise<unknown> = Promise.resolve();
  private generating: Promise<unknown> | null = null;

  constructor(
    private readonly base: Engine,
    private readonly cache: BenchCache = storageBenchCache,
  ) {}

  onLog: (message: string) => void = () => undefined;
  private log(message: string) {
    this.onLog(message);
  }

  get loaded() {
    return this.base.loaded;
  }
  get backend() {
    return this.base.backend;
  }
  get maxContextTokens() {
    return this.base.maxContextTokens;
  }
  get modalities() {
    return this.base.modalities;
  }
  capabilities(): Promise<DeviceCaps> {
    return this.base.capabilities();
  }
  benchmark() {
    return this.base.benchmark();
  }

  /** Serialises loads and reloads (a reload waits for a running generation first). */
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      await this.generating?.catch(() => undefined);
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The backend asked for (admin override, else this app's setting); undefined = automatic. */
  get preferredBackend(): Backend | undefined {
    return this.wanted().backend;
  }

  private wanted(): ComputePrefs {
    return {
      backend: this.admin.backend ?? this.local.backend,
      maxContextTokens: this.admin.maxContextTokens ?? this.local.maxContextTokens,
      enableMtp: this.admin.enableMtp ?? this.local.enableMtp,
    };
  }

  load(path: string): Promise<void> {
    this.path = path;
    return this.queue(() => this.apply(path));
  }

  unload() {
    return this.queue(async () => {
      this.path = null;
      this.applied = '';
      await this.base.unload();
    });
  }

  async setPrefs(source: 'local' | 'admin', prefs: ComputePrefs) {
    if (source === 'local') this.local = prefs;
    else this.admin = prefs;
    const path = this.path;
    // Reload only when a model is loaded and the effective settings differ from what is running.
    if (path && JSON.stringify(this.wanted()) !== this.applied) {
      await this.queue(() => (this.path === path ? this.apply(path) : Promise.resolve()));
    }
  }

  async generate(
    req: GenerateRequest,
    onText: (t: string) => void,
    signal: AbortSignal,
  ): Promise<GenerateResult> {
    await this.chain; // a reload in progress finishes first
    const run = this.base.generate(req, onText, signal);
    this.generating = run;
    try {
      return await run;
    } finally {
      if (this.generating === run) this.generating = null;
    }
  }

  private async apply(path: string) {
    const wanted = this.wanted();
    const caps = await this.base.capabilities();
    const ctx = wanted.maxContextTokens ?? autoContext(caps.totalMemoryMb);
    let backend = wanted.backend;
    if (backend === 'gpu' && !caps.gpuAvailable) {
      this.log('GPU requested but this device has no usable GPU driver: using the CPU');
      backend = 'cpu';
    }
    backend ??= await this.fastest(path, ctx, caps);
    // Fallbacks, in order: as asked, the CPU, the CPU with the default window.
    const mtp = wanted.enableMtp === true;
    const attempts: [Backend, number, boolean][] = [
      [backend, ctx, mtp],
      [backend, ctx, false], // a bundle without a drafter, or a backend that cannot run it
      ['cpu', ctx, false],
      ['cpu', DEFAULT_CONTEXT, false],
    ];
    let lastError: unknown;
    for (const [i, [b, c, m]] of attempts.entries()) {
      const prev = attempts[i - 1];
      if (prev && b === prev[0] && c === prev[1] && m === prev[2]) continue;
      try {
        await this.base.load(path, { backend: b, maxContextTokens: c, enableMtp: m });
        this.applied = JSON.stringify(wanted);
        this.log(`Engine loaded on ${b.toUpperCase()}, context ${c} tokens${m ? ', MTP on' : ''}`);
        return;
      } catch (e) {
        lastError = e;
        this.log(
          `Loading on ${b.toUpperCase()} with context ${c}${m ? ' and MTP' : ''} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    throw lastError instanceof Error ? lastError : new Error('The model could not be loaded');
  }

  /** Measures CPU against GPU once per model file on this device. */
  private async fastest(path: string, ctx: number, caps: DeviceCaps): Promise<Backend> {
    if (!caps.gpuAvailable || caps.emulator) return 'cpu';
    const cached = await this.cache.get(path).catch(() => undefined);
    if (cached) return cached;
    this.log('Measuring CPU and GPU speed (once for this model)');
    const speed = async (b: Backend) => {
      try {
        await this.base.load(path, { backend: b, maxContextTokens: ctx });
        const rate = await this.base.benchmark();
        if (rate <= 0) this.log(`${b.toUpperCase()} measurement produced no tokens`);
        return rate;
      } catch (e) {
        // a backend that cannot load or run loses; say why, so a 0.0 is never a mystery
        this.log(
          `${b.toUpperCase()} measurement failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return 0;
      }
    };
    const cpu = await speed('cpu');
    const gpu = await speed('gpu');
    const pick: Backend = gpu > cpu * GPU_MARGIN ? 'gpu' : 'cpu';
    this.log(
      `CPU ${cpu.toFixed(1)} tok/s, GPU ${gpu.toFixed(1)} tok/s: using ${pick.toUpperCase()}`,
    );
    // Nothing measured at all is not an answer worth keeping: the next load tries again.
    if (cpu > 0 || gpu > 0) await this.cache.set(path, pick).catch(() => undefined);
    return pick;
  }
}
