import type { Engine, GenerateRequest, GenerateResult } from './types';

/**
 * Adapter over the community `react-native-litert-lm` module (Nitro, third party, not Google's; evaluate it on a real
 * device before shipping, see docs/node-app.md). Loaded lazily so the JS bundle and the tests work without the native
 * module, and so a missing module is a clear error instead of a crash at startup.
 */
interface LiteLlm {
  loadModel(path: string, config?: Record<string, unknown>): Promise<void>;
  execute(
    parts: { type: 'text'; text: string }[],
    onToken?: (token: string, done: boolean) => void,
  ): Promise<unknown>;
  resetConversation(): void;
  unload(): void;
}
interface LiteModule {
  createLLM(): LiteLlm;
}

function native(): LiteModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-litert-lm') as LiteModule;
  } catch {
    throw new Error('The LiteRT-LM native module is not available in this build');
  }
}

/** System turn(s) and the rest of the conversation, flattened into what the engine takes: a system prompt + one user turn. */
export function flatten(messages: { role: string; content: string }[]): {
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
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');
  return { system, prompt: `${transcript}\nAssistant:` };
}

export class LiteRtEngine implements Engine {
  private llm: LiteLlm | null = null;
  private path: string | null = null;
  private busy = false;

  get loaded() {
    return this.llm !== null;
  }

  async load(path: string) {
    await this.unload();
    const llm = native().createLLM();
    await llm.loadModel(path, {});
    this.llm = llm;
    this.path = path;
  }

  async unload() {
    this.llm?.unload();
    this.llm = null;
    this.path = null;
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
        await this.llm.execute([{ type: 'text', text: prompt }], (token) => {
          if (cancelled || !token) return;
          produced += 1;
          onText(token);
        });
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
    await this.llm.loadModel(this.path, config);
    this.lastConfig = key;
  }
}
