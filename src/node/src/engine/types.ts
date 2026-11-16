export interface ChatMessage {
  role: string;
  content: string;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  /** 0 = engine default. */
  maxTokens: number;
  temperature: number;
  topP: number;
}

export interface GenerateResult {
  finishReason: 'stop' | 'length';
}

export type Backend = 'cpu' | 'gpu';

/** Engine settings; a missing field means "decide for me" (see `ComputeEngine`). */
export interface ComputePrefs {
  backend?: Backend;
  /** Context window in tokens (prompt + history + output). */
  maxContextTokens?: number;
  /** Multi-token prediction: speculative decoding with the model bundle's drafter (ignored when it has none). */
  enableMtp?: boolean;
}

/** What the device can do. */
export interface DeviceCaps {
  /** A GPU driver is present (OpenCL on Android). */
  gpuAvailable: boolean;
  /** Emulators report a GPU that is software rendered: never picked automatically. */
  emulator: boolean;
  /** 0 = unknown. */
  totalMemoryMb: number;
}

/**
 * The inference engine behind the node. LiteRT-LM is the only supported engine (see CLAUDE.md); nothing outside
 * `engine/` may depend on its specifics. One generation runs at a time.
 */
export interface Engine {
  /** Loads the `.litertlm` file at a local path (replacing any loaded model). */
  load(path: string, opts?: ComputePrefs): Promise<void>;
  unload(): Promise<void>;
  readonly loaded: boolean;
  /** What the loaded model actually runs on (null when nothing is loaded). */
  readonly backend: Backend | null;
  /** The loaded model's context window in tokens (0 when nothing is loaded). */
  readonly maxContextTokens: number;
  capabilities(): DeviceCaps;
  /** Decode speed (tokens/sec) of a short fixed generation on the loaded model. */
  benchmark(): Promise<number>;
  /** Streams text pieces through `onText`; aborting `signal` stops generation. */
  generate(
    req: GenerateRequest,
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<GenerateResult>;
}

/** The engine plus the policy that picks its settings: admin override, else the device's own setting, else automatic. */
export interface TunableEngine extends Engine {
  /** Where the engine reports what it decided (shown on the Logs screen). */
  onLog?: (message: string) => void;
  /** `admin` (from the web app, through the gateway) wins over `local` (this app's settings) field by field. */
  setPrefs(source: 'local' | 'admin', prefs: ComputePrefs): Promise<void>;
}
