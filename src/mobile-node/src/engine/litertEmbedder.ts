import type { Embedder } from './types';

/**
 * Adapter over `createEmbedder()` of the community `react-native-litert-lm` module (LiteRT-LM's EmbeddingEngine, a
 * separate engine from the chat `LiteRtEngine`). Required lazily, like the chat adapter. Text only: embedding bundles
 * with image/audio encoders are used as text encoders here.
 */
interface LiteEmbedder {
  loadModel(path: string, config?: Record<string, unknown>): Promise<void>;
  embedBatch(inputs: string[], options?: { normalize?: boolean }): Promise<Float32Array[]>;
  getModelInfo(): { embedding?: { dimension: number | null } } | null;
  unload(): Promise<void>;
  close(): void;
}
interface LiteModule {
  createEmbedder(): LiteEmbedder;
}

function native(): LiteModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-litert-lm') as LiteModule;
  } catch {
    throw new Error('The LiteRT-LM native module is not available in this build');
  }
}

export class LiteRtEmbedder implements Embedder {
  private lite: LiteEmbedder | null = null;
  private dim = 0;

  get loaded() {
    return this.lite !== null;
  }
  get dimension() {
    return this.dim;
  }

  async load(path: string) {
    await this.unload();
    const lite = native().createEmbedder();
    try {
      await lite.loadModel(path);
      // The bundle declares its width; when it does not, one probe vector tells.
      let dim = lite.getModelInfo()?.embedding?.dimension ?? 0;
      if (dim <= 0) dim = (await lite.embedBatch(['probe'], { normalize: true }))[0]?.length ?? 0;
      if (dim <= 0) throw new Error('The embedding model reports no dimension');
      this.dim = dim;
    } catch (e) {
      lite.close();
      throw e;
    }
    this.lite = lite;
  }

  async unload() {
    const lite = this.lite;
    this.lite = null;
    this.dim = 0;
    if (lite) {
      await lite.unload().catch(() => undefined);
      lite.close();
    }
  }

  async embed(texts: string[]) {
    if (!this.lite) throw new Error('No embedding model is loaded');
    // Unit-length full vectors; shortening them is done by `embedAll` (it renormalises).
    return this.lite.embedBatch(texts, { normalize: true });
  }
}
