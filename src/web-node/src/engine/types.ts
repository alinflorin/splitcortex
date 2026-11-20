/** A piece of a message with media in it (the proto's `ContentPart`); the engine reads it from the bytes. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: Uint8Array }
  | { type: 'audio'; mimeType: string; data: Uint8Array };

/** What a model accepts besides text. */
export type Modality = 'image' | 'audio';

export interface ChatMessage {
  role: string;
  /** The message's text. */
  content: string;
  /** Set when the message has media: every part in order, text included (then it replaces `content`). */
  parts?: ContentPart[];
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
  /** WebGPU is available (an adapter could be requested). */
  gpuAvailable: boolean;
  /** Software-rendered GPUs (a fallback adapter) are never picked automatically. */
  emulator: boolean;
  /** 0 = unknown. */
  totalMemoryMb: number;
}

/**
 * The inference engine behind the node. LiteRT-LM is the only supported engine (see CLAUDE.md); nothing outside
 * `engine/` may depend on its specifics. One generation runs at a time.
 */
export interface Engine {
  /** Loads the `.litertlm` model stored under this name (replacing any loaded model). */
  load(name: string, opts?: ComputePrefs): Promise<void>;
  unload(): Promise<void>;
  readonly loaded: boolean;
  /** What the loaded model actually runs on (null when nothing is loaded). */
  readonly backend: Backend | null;
  /** The loaded model's context window in tokens (0 when nothing is loaded). */
  readonly maxContextTokens: number;
  /** What the loaded model accepts besides text (empty when text only or nothing is loaded). */
  readonly modalities: readonly Modality[];
  capabilities(): Promise<DeviceCaps>;
  /** Decode speed (tokens/sec) of a short fixed generation on the loaded model. */
  benchmark(): Promise<number>;
  /** Streams text pieces through `onText`; aborting `signal` stops generation. */
  generate(
    req: GenerateRequest,
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<GenerateResult>;
}

/** What an embedding engine returns for a batch: full-size vectors, in input order. */
export interface EmbedResult {
  vectors: number[][];
  /** Tokens of all inputs together; 0 when the engine cannot tell. */
  promptTokens: number;
}

/**
 * The embedding capability (LiteRT-LM's embedding engine, a separate engine from the chat one: a pool serves either
 * a chat or an embedding model, never both). Takes the already prefixed text and returns the model's own vectors;
 * the task prefix and the `dimensions` truncation live in `embedding.ts`, outside the adapter.
 */
export interface Embedder {
  /** Loads the `.litertlm` embedding model stored under this name (replacing any loaded model). */
  load(name: string): Promise<void>;
  unload(): Promise<void>;
  readonly loaded: boolean;
  /** Length of the vectors of the loaded model (0 when nothing is loaded). */
  readonly dimension: number;
  embed(texts: string[]): Promise<EmbedResult>;
}

/** The engine plus the policy that picks its settings: admin override, else the device's own setting, else automatic. */
export interface TunableEngine extends Engine {
  /** Where the engine reports what it decided (shown on the Logs screen). */
  onLog?: (message: string) => void;
  /** `admin` (from the web app, through the gateway) wins over `local` (this app's settings) field by field. */
  setPrefs(source: 'local' | 'admin', prefs: ComputePrefs): Promise<void>;
}
