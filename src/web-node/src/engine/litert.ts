import type {
  Backend,
  ComputePrefs,
  DeviceCaps,
  Engine,
  GenerateRequest,
  GenerateResult,
} from './types';

/**
 * Adapter over Google's LiteRT-LM JavaScript API (`@litert-lm/core`, WebAssembly + WebGPU). The package is imported
 * lazily (it is large and only the engine needs it) and through the small interfaces below, so nothing else depends on
 * its types and tests can inject a fake. The WASM runtime is served by this app itself (`/litertlm/`, copied from the
 * package at build time): the package's default is a CDN URL, and this project never uses CDNs.
 */
interface LiteChunk {
  content?: { type?: string; text?: string }[];
}
interface LiteConversation {
  sendMessageStreaming(message: { role: string; content: string }): AsyncIterable<LiteChunk>;
  cancel(): void;
  delete(): Promise<void>;
}
interface LiteEngine {
  createConversation(config?: {
    preface?: { messages?: { role: string; content: string }[] };
    sessionConfig?: {
      maxOutputTokens?: number;
      samplerParams?: { type?: number; temperature?: number; p?: number };
    };
  }): Promise<LiteConversation>;
  delete(): Promise<void>;
}
export interface LiteModule {
  loadLiteRtLm(path: string): Promise<unknown>;
  Engine: {
    create(settings: {
      model: Blob;
      backend?: number;
      mainExecutorSettings?: { maxNumTokens?: number };
    }): Promise<LiteEngine>;
  };
  Backend: { CPU: number; GPU: number };
  SamplerType: { TOP_P: number };
}

/** Context window when none is asked for (the runtime is WASM32: memory is the limit, keep the KV cache modest). */
export const DEFAULT_CONTEXT = 4096;
const BENCH_PROMPT = 'Count from one to one hundred in words.';
const BENCH_TOKENS = 40;
/** Where the build serves the LiteRT-LM WASM runtime (vite.config.ts copies it there). */
export const WASM_PATH = '/litertlm/';

const importLite = (): Promise<LiteModule> =>
  import('@litert-lm/core') as unknown as Promise<LiteModule>;

/** What `navigator.gpu` gives; typed locally because the DOM lib has no WebGPU types. */
interface GpuNavigator {
  gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean } | null> };
  deviceMemory?: number;
}

export interface LiteRtEngineOptions {
  /** Gives the stored model file (OPFS) for the name the model manager loads. */
  openModel: (name: string) => Promise<Blob>;
  loadModule?: () => Promise<LiteModule>;
  nav?: GpuNavigator;
}

/** The text of a streamed chunk (`content` parts of type `text`). */
const textOf = (chunk: LiteChunk) =>
  (chunk.content ?? [])
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('');

export class LiteRtEngine implements Engine {
  private lite: LiteEngine | null = null;
  private mod: LiteModule | null = null;
  private wasmReady: Promise<unknown> | null = null;
  private busy = false;
  private active: { backend: Backend; ctx: number } | null = null;
  private caps: Promise<DeviceCaps> | null = null;
  private current: LiteConversation | null = null;

  constructor(private readonly o: LiteRtEngineOptions) {}

  private get nav(): GpuNavigator {
    return this.o.nav ?? (globalThis.navigator as unknown as GpuNavigator);
  }

  get loaded() {
    return this.lite !== null;
  }
  get backend() {
    return this.active?.backend ?? null;
  }
  get maxContextTokens() {
    return this.active?.ctx ?? 0;
  }

  /** WebGPU present and a real (not software fallback) adapter; RAM from `navigator.deviceMemory` (Chromium, capped at 8 GB). */
  capabilities(): Promise<DeviceCaps> {
    this.caps ??= (async () => {
      const mem = this.nav.deviceMemory ? Math.round(this.nav.deviceMemory * 1024) : 0;
      try {
        const adapter = await this.nav.gpu?.requestAdapter();
        return {
          gpuAvailable: !!adapter && !adapter.isFallbackAdapter,
          emulator: false,
          totalMemoryMb: mem,
        };
      } catch {
        return { gpuAvailable: false, emulator: false, totalMemoryMb: mem };
      }
    })();
    return this.caps;
  }

  private async module(): Promise<LiteModule> {
    this.mod ??= await (this.o.loadModule ?? importLite)();
    this.wasmReady ??= this.mod.loadLiteRtLm(`${location.origin}${WASM_PATH}`);
    await this.wasmReady;
    return this.mod;
  }

  async load(name: string, opts: ComputePrefs = {}) {
    await this.unload();
    const mod = await this.module();
    const backend: Backend = opts.backend ?? 'cpu';
    const ctx = opts.maxContextTokens ?? DEFAULT_CONTEXT;
    // The file comes from OPFS as a lazily read File: the runtime streams it, it is never one big JS buffer.
    const model = await this.o.openModel(name);
    this.lite = await mod.Engine.create({
      model,
      backend: backend === 'gpu' ? mod.Backend.GPU : mod.Backend.CPU,
      mainExecutorSettings: { maxNumTokens: ctx },
    });
    this.active = { backend, ctx };
  }

  async unload() {
    this.current?.cancel();
    const lite = this.lite;
    this.lite = null;
    this.active = null;
    this.current = null;
    await lite?.delete().catch(() => undefined);
  }

  async benchmark(): Promise<number> {
    if (!this.lite || this.busy) return 0;
    this.busy = true;
    try {
      const conv = await this.lite.createConversation();
      let n = 0;
      let first = 0;
      let last = 0;
      try {
        for await (const chunk of conv.sendMessageStreaming({
          role: 'user',
          content: BENCH_PROMPT,
        })) {
          if (!textOf(chunk)) continue;
          n += 1;
          last = Date.now();
          if (n === 1) first = last;
          if (n >= BENCH_TOKENS) break; // leaving the loop cancels the generation
        }
      } finally {
        await conv.delete().catch(() => undefined);
      }
      // Decode speed only: the time to the first token (prefill, warm-up) is not counted.
      return n > 1 && last > first ? ((n - 1) * 1000) / (last - first) : 0;
    } finally {
      this.busy = false;
    }
  }

  async generate(
    req: GenerateRequest,
    onText: (t: string) => void,
    signal: AbortSignal,
  ): Promise<GenerateResult> {
    const mod = this.mod;
    if (!this.lite || !mod) throw new Error('No model is loaded');
    if (this.busy) throw new Error('The engine is busy');
    this.busy = true;
    try {
      // Every OpenAI request is self-contained: a fresh conversation whose preface is the history, the last turn is sent.
      const last = req.messages[req.messages.length - 1];
      if (!last) throw new Error('The request has no messages');
      const sessionConfig: NonNullable<
        Parameters<LiteEngine['createConversation']>[0]
      >['sessionConfig'] = {};
      if (req.maxTokens > 0) sessionConfig.maxOutputTokens = req.maxTokens;
      if (req.temperature > 0 || req.topP > 0) {
        sessionConfig.samplerParams = { type: mod.SamplerType.TOP_P };
        if (req.temperature > 0) sessionConfig.samplerParams.temperature = req.temperature;
        if (req.topP > 0) sessionConfig.samplerParams.p = req.topP;
      }
      const conv = await this.lite.createConversation({
        preface: {
          messages: req.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        },
        sessionConfig,
      });
      this.current = conv;
      const onAbort = () => conv.cancel();
      signal.addEventListener('abort', onAbort);
      let produced = 0;
      try {
        for await (const chunk of conv.sendMessageStreaming({
          role: last.role,
          content: last.content,
        })) {
          if (signal.aborted) break;
          const text = textOf(chunk);
          if (!text) continue;
          produced += 1;
          onText(text);
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        if (this.current === conv) this.current = null;
        await conv.delete().catch(() => undefined);
      }
      return { finishReason: req.maxTokens > 0 && produced >= req.maxTokens ? 'length' : 'stop' };
    } finally {
      this.busy = false;
    }
  }
}
