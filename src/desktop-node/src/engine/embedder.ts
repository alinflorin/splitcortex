import { tauriApi, type NativeApi } from '../native/ipc';
import type { Embedder } from './types';

/**
 * Adapter over the native LiteRT-LM embedding engine (src-tauri/src/engine/embed.rs). Runs on the CPU. Not run
 * against a real model yet (see docs/desktop-node.md).
 */
export class NativeEmbedder implements Embedder {
  private dim = 0;
  private isLoaded = false;

  constructor(private readonly api: NativeApi = tauriApi) {}

  get loaded() {
    return this.isLoaded;
  }
  get dimension() {
    return this.dim;
  }

  async load(name: string) {
    await this.unload();
    const info = await this.api.embedderLoad(name);
    this.dim = info.dimension;
    this.isLoaded = true;
  }

  async unload() {
    this.isLoaded = false;
    this.dim = 0;
    await this.api.embedderUnload();
  }

  async embed(inputs: string[]) {
    if (!this.isLoaded) throw new Error('No embedding model is loaded');
    // The C API does not report how many tokens it read.
    return { vectors: await this.api.embedderEmbed(inputs), promptTokens: 0 };
  }
}
