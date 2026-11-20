import type { Embedder } from './types';

/**
 * Task prefixes of EmbeddingGemma (model card "Prompt Instructions"; the LiteRT-LM web package has no helper for
 * them). The gateway only sends the task name; the node writes the prefix.
 */
const PREFIXES: Record<string, string> = {
  '': '',
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
  classification: 'task: classification | query: ',
  clustering: 'task: clustering | query: ',
  similarity: 'task: sentence similarity | query: ',
};

/** What the engines say when an input is over the window (the overflow strategy is "error"). */
const INPUT_TOO_LONG =
  /signature length|exceed|too long|overflow|out of range|longer than|OUT_OF_RANGE|bad_input:/i;
const TOO_LONG = 'An input is longer than the model accepts';

/** The request is wrong (not the engine): becomes an `InferenceError` with code `bad_request`. */
export class EmbeddingRequestError extends Error {}

/** Trims and prefixes every input for the task; an unknown task is a bad request. */
export function prepareInputs(inputs: readonly string[], task: string): string[] {
  const prefix = PREFIXES[task];
  if (prefix === undefined) throw new EmbeddingRequestError(`Unknown embedding task "${task}"`);
  if (inputs.length === 0) throw new EmbeddingRequestError('No inputs to embed');
  return inputs.map((s) => prefix + s.trim());
}

/** Matryoshka truncation: the first `dimensions` values, L2-renormalised. Unchanged when 0 or not smaller than the vector. */
export function shrink(vector: number[], dimensions: number): number[] {
  if (dimensions <= 0 || dimensions >= vector.length) return vector;
  const cut = vector.slice(0, dimensions);
  const norm = Math.hypot(...cut);
  return norm > 0 ? cut.map((v) => v / norm) : cut;
}

export interface EmbedRequest {
  inputs: readonly string[];
  task: string;
  dimensions: number;
}

/** Answers one embedding request with the loaded embedder: same order as the inputs. */
export async function runEmbedding(embedder: Embedder, req: EmbedRequest) {
  const texts = prepareInputs(req.inputs, req.task);
  let out;
  try {
    out = await embedder.embed(texts);
  } catch (e) {
    // An input over the model's window is the client's mistake, as on every other node type.
    if (INPUT_TOO_LONG.test(String(e))) throw new EmbeddingRequestError(TOO_LONG);
    throw e;
  }
  if (out.vectors.length !== texts.length)
    throw new Error('The engine returned a wrong vector count');
  // Never hand out NaN or infinity (the gateway would serialise them as null).
  if (out.vectors.some((v) => !v.every(Number.isFinite)))
    throw new Error('The engine produced invalid (NaN) vectors');
  // More dimensions than the model makes is the client's mistake, as on every other node type.
  const full = out.vectors[0]?.length ?? 0;
  if (full > 0 && req.dimensions > full)
    throw new EmbeddingRequestError(
      `The model makes ${full} dimensions, ${req.dimensions} were asked for`,
    );
  return {
    vectors: out.vectors.map((v) => shrink(v, req.dimensions)),
    promptTokens: out.promptTokens,
  };
}
