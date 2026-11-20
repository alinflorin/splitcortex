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
  /** What the loaded model accepts besides text (empty when text only or nothing is loaded). */
  readonly modalities: readonly Modality[];
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

/** The kind of text an embedding is for (the protocol's `EmbeddingRequest.task`). */
export type EmbeddingTask =
  '' | 'query' | 'document' | 'classification' | 'clustering' | 'similarity';

/**
 * The embedding capability, a second engine next to `Engine` (LiteRT-LM's EmbeddingEngine). A pool serves either a
 * chat model or an embedding model, never both, so the node keeps only one of the two loaded.
 */
export interface Embedder {
  /** Loads the `.litertlm` embedding bundle at a local path (replacing any loaded one). */
  load(path: string): Promise<void>;
  unload(): Promise<void>;
  readonly loaded: boolean;
  /** Length of the vectors `embed` returns (0 when nothing is loaded). */
  readonly dimension: number;
  /** One L2-normalised vector of `dimension` numbers per (already prefixed) text, in order, in one engine call. */
  embed(texts: string[]): Promise<ArrayLike<number>[]>;
}

/** The engine plus the policy that picks its settings: admin override, else the device's own setting, else automatic. */
export interface TunableEngine extends Engine {
  /** Where the engine reports what it decided (shown on the Logs screen). */
  onLog?: (message: string) => void;
  /** `admin` (from the web app, through the gateway) wins over `local` (this app's settings) field by field. */
  setPrefs(source: 'local' | 'admin', prefs: ComputePrefs): Promise<void>;
}
