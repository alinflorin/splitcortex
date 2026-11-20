import type { Embedder, EmbedResult } from './types';
import { loadRuntime } from './litert';

/**
 * Adapter over `@litert-lm/core`'s `EmbeddingEngine` (same WASM build as the chat engine, same self-served runtime
 * path; imported lazily). Not verified on a real EmbeddingGemma file yet.
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

const importLite = (): Promise<LiteEmbeddingModule> =>
  import('@litert-lm/core') as unknown as Promise<LiteEmbeddingModule>;

export interface LiteRtEmbedderOptions {
  openModel: (name: string) => Promise<Blob>;
  /** WebGPU is usable (the embedding engine's default backend is the GPU; the CPU is the fallback). */
  gpuAvailable: () => Promise<boolean>;
  loadModule?: () => Promise<LiteEmbeddingModule>;
}

export class LiteRtEmbedder implements Embedder {
  private lite: LiteEmbeddingEngine | null = null;
  private mod: LiteEmbeddingModule | null = null;
  private dim = 0;
  /** The longest input (tokens) the loaded engine was built for; the engine itself does not enforce it. */
  private window = 0;

  constructor(private readonly o: LiteRtEmbedderOptions) {}

  get loaded() {
    return this.lite !== null;
  }
  get dimension() {
    return this.dim;
  }

  async load(name: string) {
    await this.unload();
    this.mod ??= await (this.o.loadModule ?? importLite)();
    const mod = this.mod;
    await loadRuntime(mod);
    const model = await this.o.openModel(name);
    const gpu = await this.o.gpuAvailable();
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
    // shows whether the backend computes sane numbers (EmbeddingGemma yields NaN on some WebGPU setups).
    const start = async (backend: number) => {
      const lite = await create(backend);
      try {
        const [probe] = await lite.computeEmbeddingBatch(['dimension probe'], this.options(mod));
        const v = probe?.embedding ?? [];
        return { lite, dim: v.length, finite: v.every(Number.isFinite) };
      } catch (e) {
        await lite.delete().catch(() => undefined);
        throw e;
      }
    };
    let started;
    try {
      started = await start(gpu ? mod.Backend.GPU : mod.Backend.CPU);
    } catch (e) {
      if (!gpu) throw e;
      started = await start(mod.Backend.CPU);
    }
    if (gpu && started.dim > 0 && !started.finite) {
      await started.lite.delete().catch(() => undefined);
      started = await start(mod.Backend.CPU); // the GPU gave NaN: the CPU is slower but right
    }
    if (started.dim === 0) {
      await started.lite.delete().catch(() => undefined);
      throw new Error('The embedding model returned an empty vector');
    }
    if (!started.finite) {
      await started.lite.delete().catch(() => undefined);
      throw new Error('The embedding model produces invalid (NaN) vectors on this device');
    }
    this.lite = started.lite;
    this.dim = started.dim;
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
