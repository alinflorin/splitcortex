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
  const out = await embedder.embed(texts);
  if (out.vectors.length !== texts.length)
    throw new Error('The engine returned a wrong vector count');
  return {
    vectors: out.vectors.map((v) => shrink(v, req.dimensions)),
    promptTokens: out.promptTokens,
  };
}
