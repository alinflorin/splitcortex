import { tauriApi, type NativeApi } from '../native/ipc';
import type {
  Backend,
  ComputePrefs,
  DeviceCaps,
  Engine,
  GenerateRequest,
  GenerateResult,
} from './types';

/**
 * Adapter over the native LiteRT-LM engine (src-tauri/src/engine: the official C API loaded at run time). The only
 * file that knows how generation reaches it; everything else uses the `Engine` interface. Not run against a real model
 * on every platform yet (see docs/desktop-node.md).
 */

/** Context window when none is asked for. */
export const DEFAULT_CONTEXT = 4096;
const BENCH_PROMPT = 'Count from one to one hundred in words.';
const BENCH_TOKENS = 40;

export class NativeEngine implements Engine {
  private active: { backend: Backend; ctx: number } | null = null;
  private busy = false;
  private caps: Promise<DeviceCaps> | null = null;

  constructor(private readonly api: NativeApi = tauriApi) {}

  get loaded() {
    return this.active !== null;
  }
  get backend() {
    return this.active?.backend ?? null;
  }
  get maxContextTokens() {
    return this.active?.ctx ?? 0;
  }

  capabilities(): Promise<DeviceCaps> {
    this.caps ??= this.api
      .engineCaps()
      .catch(() => ({ gpuAvailable: false, emulator: false, totalMemoryMb: 0 }));
    return this.caps;
  }

  async load(name: string, opts: ComputePrefs = {}) {
    await this.unload();
    const loaded = await this.api.engineLoad(
      name,
      opts.backend ?? 'cpu',
      opts.maxContextTokens ?? DEFAULT_CONTEXT,
      opts.enableMtp ?? false,
    );
    this.active = { backend: loaded.backend, ctx: loaded.maxContextTokens };
  }

  async unload() {
    this.active = null;
    await this.api.engineUnload();
  }

  async benchmark(): Promise<number> {
    if (!this.active || this.busy) return 0;
    let n = 0;
    let first = 0;
    let last = 0;
    const ctl = new AbortController();
    await this.generate(
      {
        messages: [{ role: 'user', content: BENCH_PROMPT }],
        maxTokens: BENCH_TOKENS,
        temperature: 0,
        topP: 0,
      },
      (text) => {
        if (!text) return;
        n += 1;
        last = Date.now();
        if (n === 1) first = last;
      },
      ctl.signal,
    );
    // Decode speed only: the time to the first token (prefill, warm-up) is not counted.
    return n > 1 && last > first ? ((n - 1) * 1000) / (last - first) : 0;
  }

  async generate(
    req: GenerateRequest,
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<GenerateResult> {
    if (!this.active) throw new Error('No model is loaded');
    if (this.busy) throw new Error('The engine is busy');
    if (req.messages.length === 0) throw new Error('The request has no messages');
    this.busy = true;
    let produced = 0;
    const onAbort = () => void this.api.engineCancel().catch(() => undefined);
    signal.addEventListener('abort', onAbort);
    try {
      if (signal.aborted) return { finishReason: 'stop' };
      await this.api.engineGenerate(
        {
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          topP: req.topP,
        },
        (text) => {
          if (!text || signal.aborted) return;
          produced += 1;
          onText(text);
        },
      );
      return { finishReason: req.maxTokens > 0 && produced >= req.maxTokens ? 'length' : 'stop' };
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.busy = false;
    }
  }
}
