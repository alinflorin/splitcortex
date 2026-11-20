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

/** Longest input in tokens (the library's default is 1024; EmbeddingGemma accepts up to 2048). */
const MAX_INPUT = 2048;

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
    const settings = { model, maxInputLength: MAX_INPUT };
    try {
      this.lite = await mod.EmbeddingEngine.create({
        ...settings,
        backend: gpu ? mod.Backend.GPU : mod.Backend.CPU,
      });
    } catch (e) {
      if (!gpu) throw e;
      this.lite = await mod.EmbeddingEngine.create({ ...settings, backend: mod.Backend.CPU });
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
