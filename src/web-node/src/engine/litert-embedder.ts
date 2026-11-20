import type { Embedder, EmbedResult } from './types';
import { WASM_PATH } from './litert';

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
    }): Promise<LiteEmbeddingEngine>;
  };
  Backend: { CPU: number; GPU: number };
  InputOverflowStrategy: { ERROR: number };
}

/** The longest window (tokens) we ask for; the engine's own limit for the model wins when it is lower. */
const WANTED_INPUT = 8192;
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
    await mod.loadLiteRtLm(`${location.origin}${WASM_PATH}`);
    const model = await this.o.openModel(name);
    const gpu = await this.o.gpuAvailable();
    // No model size is assumed: ask for the largest window we would ever want and let the file say what it has.
    const create = async (backend: number) => {
      let maxInputLength = WANTED_INPUT;
      for (;;) {
        try {
          return await mod.EmbeddingEngine.create({ model, backend, maxInputLength });
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
    try {
      this.lite = await create(gpu ? mod.Backend.GPU : mod.Backend.CPU);
    } catch (e) {
      if (!gpu) throw e;
      this.lite = await create(mod.Backend.CPU);
    }
    try {
      // The vector length is not a property of the engine: ask the model once.
      const [probe] = await this.lite.computeEmbeddingBatch(['dimension probe'], this.options(mod));
      this.dim = probe?.embedding.length ?? 0;
      if (this.dim === 0) throw new Error('The embedding model returned an empty vector');
    } catch (e) {
      await this.unload();
      throw e;
    }
  }

  private options(mod: LiteEmbeddingModule) {
    return { normalize: true, inputOverflowStrategy: mod.InputOverflowStrategy.ERROR };
  }

  async unload() {
    const lite = this.lite;
    this.lite = null;
    this.dim = 0;
    await lite?.delete().catch(() => undefined);
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const lite = this.lite;
    const mod = this.mod;
    if (!lite || !mod) throw new Error('No embedding model is loaded');
    // Input longer than the model's window is an error, never silently cut.
    const out = await lite.computeEmbeddingBatch(texts, this.options(mod));
    return {
      vectors: out.map((r) => r.embedding),
      promptTokens: out.reduce((n, r) => n + (r.inputLength || 0), 0),
    };
  }
}
