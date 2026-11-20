import type { Embedder } from './types';

/**
 * The task prefixes EmbeddingGemma was trained with (model card "Prompt Instructions"). The text goes after the prefix;
 * "document" has the title slot ("title: none | text: ") because the gateway sends no titles. The LiteRT-LM C API has
 * no helper for these, so the node writes them.
 */
export const TASK_PREFIXES: Record<string, string> = {
  '': '',
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
  classification: 'task: classification | query: ',
  clustering: 'task: clustering | query: ',
  similarity: 'task: sentence similarity | query: ',
};

/** What a model is for: "embedding" is loaded into the embedder, anything else ("", "chat") into the chat engine. */
export type ModelKind = 'chat' | 'embedding';
export const kindOf = (kind: string | undefined): ModelKind =>
  kind === 'embedding' ? 'embedding' : 'chat';

/** A request the node cannot answer because of what was asked (not an engine failure). */
export class EmbeddingInputError extends Error {}

/** Trims the text and puts the task's prefix before it. */
export function prefixInput(task: string, text: string): string {
  const prefix = TASK_PREFIXES[task];
  if (prefix === undefined) throw new EmbeddingInputError(`Unknown embedding task "${task}"`);
  return prefix + text.trim();
}

/**
 * Cuts a vector to its first `dimensions` values and scales it back to length 1 (Matryoshka models). 0, or a size
 * that is not smaller than the vector, leaves it as it is.
 */
export function applyDimensions(vector: number[], dimensions: number): number[] {
  if (dimensions <= 0 || dimensions >= vector.length) return vector;
  const cut = vector.slice(0, dimensions);
  let sum = 0;
  for (const v of cut) sum += v * v;
  const norm = Math.sqrt(sum);
  return norm > 0 ? cut.map((v) => v / norm) : cut;
}

/** Embeds every input (prefixed for the task, one vector each, same order) and applies `dimensions`. */
export async function embedTexts(
  embedder: Embedder,
  inputs: string[],
  task: string,
  dimensions: number,
): Promise<{ vectors: number[][]; promptTokens: number }> {
  if (inputs.length === 0) throw new EmbeddingInputError('The request has no inputs');
  if (inputs.some((t) => t.trim() === '')) throw new EmbeddingInputError('An input is empty');
  const prepared = inputs.map((t) => prefixInput(task, t));
  const { vectors, promptTokens } = await embedder.embed(prepared);
  if (vectors.length !== inputs.length)
    throw new Error('The engine returned a different number of vectors than inputs');
  return { vectors: vectors.map((v) => applyDimensions(v, dimensions)), promptTokens };
}
