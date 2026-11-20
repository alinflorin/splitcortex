import type { Backend, DeviceCaps, Embedder, EmbedResult } from './types';
import { GPU_MARGIN, storageBenchCache, type BenchCache } from './compute';
import { loadRuntime } from './litert';

/**
 * Adapter over `@litert-lm/core`'s `EmbeddingEngine` (same WASM build as the chat engine, same self-served runtime
 * path; imported lazily). Checked with the community EmbeddingGemma file in Chromium (CPU).
 */
interface LiteResponse {
  embedding: number[];
  inputLength: number;
}
interface LiteEmbeddingEngine {
  computeEmbeddingBatch(
    inputs: string[],
    options?: { normalize?: boolean; inputOverflowStrategy?: number },
  ): Promise<LiteResponse[]>;
  delete(): Promise<void>;
}
export interface LiteEmbeddingModule {
  loadLiteRtLm(path: string): Promise<unknown>;
  EmbeddingEngine: {
    create(settings: {
      model: Blob;
      backend?: number;
      maxInputLength?: number;
      minInputLength?: number;
    }): Promise<LiteEmbeddingEngine>;
  };
  Backend: { CPU: number; GPU: number };
  InputOverflowStrategy: { ERROR: number };
}

/** The longest window (tokens) we ask for; the engine's own limit for the model wins when it is lower. */
const WANTED_INPUT = 8192;
/** The shortest signature prepared next to the longest (see `create` in `load`). */
const MIN_SIGNATURE = 64;
/** Below this a window is useless: give up and report the engine's error. */
const MIN_INPUT = 32;
/** The GPU's vector for the probe text must point the same way as the CPU's, or the GPU is not used automatically. */
const MIN_AGREEMENT = 0.99;
const PROBE_TEXT = 'dimension probe';
const SPEED_TEXTS = [
  'The quick brown fox jumps over the lazy dog.',
  'Embeddings turn text into vectors that can be compared.',
  'A short one.',
  'Pools of phones, laptops and browsers serve models together.',
];

const importLite = (): Promise<LiteEmbeddingModule> =>
  import('@litert-lm/core') as unknown as Promise<LiteEmbeddingModule>;

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
};

export interface LiteRtEmbedderOptions {
  openModel: (name: string) => Promise<Blob>;
  loadModule?: () => Promise<LiteEmbeddingModule>;
  /** The backend asked for (the admin's override, else this app's setting); undefined = automatic. */
  backend?: () => Backend | undefined;
  /** What the device can do; without it the CPU is used. */
  capabilities?: () => Promise<Pick<DeviceCaps, 'gpuAvailable' | 'emulator'>>;
  /** Remembers the automatic choice per model file. */
  cache?: BenchCache;
  now?: () => number;
}

interface Started {
  lite: LiteEmbeddingEngine;
  dim: number;
  finite: boolean;
  vector: number[];
}

export class LiteRtEmbedder implements Embedder {
  private lite: LiteEmbeddingEngine | null = null;
  private mod: LiteEmbeddingModule | null = null;
  private dim = 0;
  /** The longest input (tokens) the loaded engine was built for; the engine itself does not enforce it. */
  private window = 0;
  private name: string | null = null;
  /** The backend setting the loaded engine was chosen under (undefined = automatic). */
  private usedPref: Backend | undefined;

  constructor(private readonly o: LiteRtEmbedderOptions) {}

  onLog: (message: string) => void = () => undefined;

  get loaded() {
    return this.lite !== null;
  }
  get dimension() {
    return this.dim;
  }

  async load(name: string) {
    await this.unload();
    this.name = name;
    this.mod ??= await (this.o.loadModule ?? importLite)();
    const mod = this.mod;
    await loadRuntime(mod);
    const model = await this.o.openModel(name);
    // No model size is assumed: ask for the largest window we would ever want and let the file say what it has.
    const create = async (backend: number) => {
      let maxInputLength = WANTED_INPUT;
      for (;;) {
        try {
          // The engine pads every input up to the shortest prepared signature: with only the longest one (the
          // default, min = max) a short text is 99% padding and EmbeddingGemma then yields NaN. A few shorter
          // signatures give short texts a tight graph.
          const minInputLength = Math.max(
            1,
            Math.min(MIN_SIGNATURE, Math.floor(maxInputLength / 2)),
          );
          const engine = await mod.EmbeddingEngine.create({
            model,
            backend,
            maxInputLength,
            minInputLength,
          });
          this.window = maxInputLength;
          return engine;
        } catch (e) {
          // "Requested target capacity (X) exceeds maximum available signature length (N)": use N, else halve.
          if (!/signature length/i.test(String(e))) throw e;
          const max = Number(/signature length \((\d+)\)/i.exec(String(e))?.[1]);
          const next = max > 0 && max < maxInputLength ? max : Math.floor(maxInputLength / 2);
          if (next < MIN_INPUT) throw e;
          maxInputLength = next;
        }
      }
    };
    // Creates the engine and asks the model once: that gives the vector length (not a property of the engine) and
    // shows whether the numbers are sane.
    const start = async (backend: Backend): Promise<Started> => {
      const lite = await create(backend === 'gpu' ? mod.Backend.GPU : mod.Backend.CPU);
      try {
        const [probe] = await lite.computeEmbeddingBatch([PROBE_TEXT], this.options(mod));
        const vector = probe?.embedding ?? [];
        return { lite, dim: vector.length, finite: vector.every(Number.isFinite), vector };
      } catch (e) {
        await lite.delete().catch(() => undefined);
        throw e;
      }
    };
    const drop = (s: Started | undefined) => s?.lite.delete().catch(() => undefined);
    const sane = (s: Started | undefined): s is Started => !!s && s.dim > 0 && s.finite;

    const pref = this.o.backend?.();
    const caps = (await this.o.capabilities?.()) ?? { gpuAvailable: false, emulator: false };
    let started: Started | undefined;

    /** The GPU as asked for, falling back to the CPU when it cannot run the model or gives NaN. */
    const gpuOrCpu = async () => {
      let gpu: Started | undefined;
      try {
        gpu = await start('gpu');
      } catch (e) {
        this.onLog(`Embedding on the GPU failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (sane(gpu)) return gpu;
      await drop(gpu);
      this.onLog('The GPU gave no usable vectors: using the CPU');
      return start('cpu');
    };

    if (pref === 'gpu' && !caps.gpuAvailable) {
      this.onLog('GPU requested but this device has no usable GPU driver: using the CPU');
    }
    if (pref === 'cpu' || !caps.gpuAvailable || (pref === undefined && caps.emulator)) {
      started = await start('cpu');
    } else if (pref === 'gpu') {
      started = await gpuOrCpu();
    } else {
      // Automatic: the GPU only when it computes the same vectors as the CPU and is clearly faster.
      const key = `embed:${name}`;
      const cached = await (this.o.cache ?? storageBenchCache).get(key).catch(() => undefined);
      if (cached === 'gpu') started = await gpuOrCpu();
      else if (cached === 'cpu') started = await start('cpu');
      else started = await this.measure(key, start, drop, sane);
    }
    if (started.dim === 0) {
      await drop(started);
      throw new Error('The embedding model returned an empty vector');
    }
    if (!started.finite) {
      await drop(started);
      throw new Error('The embedding model produces invalid (NaN) vectors on this device');
    }
    this.lite = started.lite;
    this.dim = started.dim;
    this.usedPref = pref;
  }

  /** Automatic choice, once per model file: engines are tried one after the other (memory), the winner is kept. */
  private async measure(
    key: string,
    start: (b: Backend) => Promise<Started>,
    drop: (s: Started | undefined) => Promise<void> | undefined,
    sane: (s: Started | undefined) => s is Started,
  ): Promise<Started> {
    this.onLog('Measuring CPU and GPU for embeddings (once for this model)');
    const now = this.o.now ?? (() => performance.now());
    const timed = async (s: Started) => {
      const t0 = now();
      await s.lite.computeEmbeddingBatch(SPEED_TEXTS, this.options(this.mod!));
      return now() - t0;
    };
    const cpu = await start('cpu');
    const cpuMs = sane(cpu) ? await timed(cpu) : Infinity;
    const reference = cpu.vector;
    const cpuDim = cpu.dim;
    await drop(cpu);
    let gpu: Started | undefined;
    try {
      gpu = await start('gpu');
    } catch (e) {
      this.onLog(`Embedding on the GPU failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    let pick: Backend = 'cpu';
    if (sane(gpu) && gpu.dim === cpuDim && cosine(gpu.vector, reference) >= MIN_AGREEMENT) {
      const gpuMs = await timed(gpu);
      pick = cpuMs > gpuMs * GPU_MARGIN ? 'gpu' : 'cpu';
      this.onLog(
        `CPU ${cpuMs.toFixed(0)} ms, GPU ${gpuMs.toFixed(0)} ms: using ${pick.toUpperCase()}`,
      );
    } else if (gpu) {
      this.onLog('The GPU computes different embeddings than the CPU: using the CPU');
    }
    await (this.o.cache ?? storageBenchCache).set(key, pick).catch(() => undefined);
    if (pick === 'gpu' && gpu) return gpu;
    await drop(gpu);
    return start('cpu');
  }

  /** The backend setting changed (admin override or this app's setting): reload when it differs from what runs. */
  async reapply() {
    if (!this.lite || !this.name) return;
    if (this.o.backend?.() === this.usedPref) return;
    await this.load(this.name);
  }

  private options(mod: LiteEmbeddingModule) {
    return { normalize: true, inputOverflowStrategy: mod.InputOverflowStrategy.ERROR };
  }

  async unload() {
    const lite = this.lite;
    this.lite = null;
    this.dim = 0;
    this.window = 0;
    await lite?.delete().catch(() => undefined);
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const lite = this.lite;
    const mod = this.mod;
    if (!lite || !mod) throw new Error('No embedding model is loaded');
    const out = await lite.computeEmbeddingBatch(texts, this.options(mod));
    // The WASM engine embeds an over-long input anyway (in chunks) instead of failing like the native one: it is an
    // error here too, never a silently different vector.
    if (this.window > 0 && out.some((r) => r.inputLength > this.window))
      throw new Error(
        `An input is longer than the model accepts (${this.window} tokens): exceeds the window`,
      );
    // Never hand out NaN (the gateway would serialise it as null).
    if (out.some((r) => !r.embedding.every(Number.isFinite)))
      throw new Error('The engine produced invalid (NaN) vectors');
    return {
      vectors: out.map((r) => r.embedding),
      promptTokens: out.reduce((n, r) => n + (r.inputLength || 0), 0),
    };
  }
}
