import type {
  Backend,
  ChatMessage,
  ComputePrefs,
  DeviceCaps,
  Engine,
  GenerateRequest,
  GenerateResult,
  Modality,
} from './types';

/**
 * Adapter over the community `react-native-litert-lm` module (Nitro, third party, not Google's; evaluate it on a real
 * device before shipping, see docs/node-app.md). Loaded lazily so the JS bundle and the tests work without the native
 * module, and so a missing module is a clear error instead of a crash at startup.
 */
/** A part of a message as the library takes it: text, or an image / audio clip as a raw buffer. */
type LitePart =
  | { type: 'text'; text: string }
  | { type: 'image'; imageBuffer: ArrayBuffer }
  | { type: 'audio'; audioBuffer: ArrayBuffer };
interface LiteLlm {
  loadModel(path: string, config?: Record<string, unknown>): Promise<void>;
  /** What the loaded bundle declares it accepts (read from its metadata). */
  getModelInfo?(): { modalities?: { vision?: boolean; audio?: boolean } } | null;
  execute(parts: LitePart[], onToken?: (token: string, done: boolean) => void): Promise<unknown>;
  resetConversation(): void;
  unload(): void;
}
interface LiteModule {
  createLLM(): LiteLlm;
  getDeviceInfo?(): { gpuAvailable: boolean; isEmulator: boolean; totalMemoryBytes: number };
}

/** Library default context window (KV cache) when none is asked for. */
export const DEFAULT_CONTEXT = 4096;
const BENCH_PROMPT = 'Count from one to one hundred in words.';
const BENCH_TOKENS = 40;

function native(): LiteModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-litert-lm') as LiteModule;
  } catch {
    throw new Error('The LiteRT-LM native module is not available in this build');
  }
}

/** A message's text for the transcript: media of earlier turns is not re-encoded, it shows as a placeholder. */
const transcriptText = (m: ChatMessage) =>
  m.parts
    ? m.parts
        .map((p) => (p.type === 'text' ? p.text : p.type === 'image' ? '[Image]' : '[Audio]'))
        .join('\n')
    : m.content;

/**
 * System turn(s) and the rest of the conversation, flattened into what the engine takes: a system prompt + one user
 * turn. Only the last turn's media is sent (see `mediaOf`); the history keeps placeholders.
 */
export function flatten(messages: ChatMessage[]): {
  system: string;
  prompt: string;
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const rest = messages.filter((m) => m.role !== 'system');
  // A single user turn is sent as is; longer histories are replayed as a transcript ending on the last user turn.
  if (rest.length <= 1) return { system, prompt: rest[0]?.content ?? '' };
  const transcript = rest
    .map((m, i) => {
      const text = i === rest.length - 1 ? m.content : transcriptText(m);
      return `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`;
    })
    .join('\n');
  return { system, prompt: `${transcript}\nAssistant:` };
}

const exact = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The images and audio clips of the last turn, in order (the library takes them after the text). */
export function mediaOf(messages: ChatMessage[]): LitePart[] {
  const last = [...messages].reverse().find((m) => m.role !== 'system');
  return (last?.parts ?? []).flatMap((p): LitePart[] =>
    p.type === 'image'
      ? [{ type: 'image', imageBuffer: exact(p.data) }]
      : p.type === 'audio'
        ? [{ type: 'audio', audioBuffer: exact(p.data) }]
        : [],
  );
}

export class LiteRtEngine implements Engine {
  private llm: LiteLlm | null = null;
  private path: string | null = null;
  private busy = false;
  /** Load-time settings every (re)load keeps. */
  private base: Record<string, unknown> = {};
  private active: { backend: Backend; ctx: number; modalities: Modality[] } | null = null;

  get loaded() {
    return this.llm !== null;
  }
  get backend() {
    return this.active?.backend ?? null;
  }
  get maxContextTokens() {
    return this.active?.ctx ?? 0;
  }
  get modalities(): readonly Modality[] {
    return this.active?.modalities ?? [];
  }

  capabilities(): DeviceCaps {
    try {
      const d = native().getDeviceInfo?.();
      if (d)
        return {
          gpuAvailable: d.gpuAvailable,
          emulator: d.isEmulator,
          totalMemoryMb: Math.round(d.totalMemoryBytes / 1024 ** 2),
        };
    } catch {
      // fall through: unknown device, assume the safe thing
    }
    return { gpuAvailable: false, emulator: false, totalMemoryMb: 0 };
  }

  async load(path: string, opts: ComputePrefs = {}) {
    await this.unload();
    const llm = native().createLLM();
    const base: Record<string, unknown> = {};
    if (opts.backend) base.backend = opts.backend;
    if (opts.maxContextTokens) base.maxContextTokens = opts.maxContextTokens;
    if (opts.enableMtp) base.enableSpeculativeDecoding = true;
    await llm.loadModel(path, base);
    this.llm = llm;
    this.path = path;
    this.base = base;
    this.lastConfig = '{}';
    // The library reads what the bundle accepts from its metadata and loads the matching encoders.
    const declared = llm.getModelInfo?.()?.modalities;
    const modalities: Modality[] = [];
    if (declared?.vision) modalities.push('image');
    if (declared?.audio) modalities.push('audio');
    this.active = {
      backend: opts.backend ?? 'cpu',
      ctx: opts.maxContextTokens ?? DEFAULT_CONTEXT,
      modalities,
    };
  }

  async unload() {
    this.llm?.unload();
    this.llm = null;
    this.path = null;
    this.active = null;
    this.base = {};
  }

  async benchmark(): Promise<number> {
    const llm = this.llm;
    if (!llm || this.busy) return 0;
    this.busy = true;
    try {
      llm.resetConversation();
      let n = 0;
      let first = 0;
      let last = 0;
      let stopped = false;
      await llm.execute([{ type: 'text', text: BENCH_PROMPT }], (token) => {
        if (stopped || !token) return;
        n += 1;
        last = Date.now();
        if (n === 1) first = last;
        if (n >= BENCH_TOKENS) {
          stopped = true;
          llm.resetConversation(); // cancels the rest of the reply
        }
      });
      llm.resetConversation();
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
    if (!this.llm || !this.path) throw new Error('No model is loaded');
    if (this.busy) throw new Error('The engine is busy');
    this.busy = true;
    try {
      const { system, prompt } = flatten(req.messages);
      // The engine keeps a conversation; every OpenAI request is self-contained, so start from a fresh one. The system
      // prompt, sampling and the output limit are load-time settings of the wrapper: reload only when they change.
      await this.configure(system, req);
      this.llm.resetConversation();
      let produced = 0;
      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
        this.llm?.resetConversation(); // cancels a running reply
      };
      signal.addEventListener('abort', onAbort);
      try {
        await this.llm.execute(
          [{ type: 'text', text: prompt }, ...mediaOf(req.messages)],
          (token) => {
            if (cancelled || !token) return;
            produced += 1;
            onText(token);
          },
        );
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      return { finishReason: req.maxTokens > 0 && produced >= req.maxTokens ? 'length' : 'stop' };
    } finally {
      this.busy = false;
    }
  }

  private lastConfig = '';
  private async configure(system: string, req: GenerateRequest) {
    const config: Record<string, unknown> = {};
    if (system) config.systemPrompt = system;
    if (req.maxTokens > 0) config.maxOutputTokens = req.maxTokens;
    if (req.temperature > 0) config.temperature = req.temperature;
    if (req.topP > 0) config.topP = req.topP;
    const key = JSON.stringify(config);
    if (key === this.lastConfig || !this.llm || !this.path) return;
    await this.llm.loadModel(this.path, { ...this.base, ...config });
    this.lastConfig = key;
  }
}
