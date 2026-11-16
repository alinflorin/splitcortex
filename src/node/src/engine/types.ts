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

/**
 * The inference engine behind the node. LiteRT-LM is the only supported engine (see CLAUDE.md); nothing outside
 * `engine/` may depend on its specifics. One generation runs at a time.
 */
export interface Engine {
  /** Loads the `.litertlm` file at a local path (replacing any loaded model). */
  load(path: string): Promise<void>;
  unload(): Promise<void>;
  readonly loaded: boolean;
  /** Streams text pieces through `onText`; aborting `signal` stops generation. */
  generate(
    req: GenerateRequest,
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<GenerateResult>;
}
