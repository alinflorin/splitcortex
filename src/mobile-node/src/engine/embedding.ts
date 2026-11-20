import type { Embedder, EmbeddingTask } from './types';

/**
 * The text prefix each task needs for EmbeddingGemma (model card / `config_sentence_transformers.json`; identical to
 * `EmbeddingTask` in `react-native-litert-lm`, which is not imported here so this file stays pure). Inputs are trimmed
 * first. The prefix is the model's own, the gateway never writes it.
 */
const PREFIX: Record<Exclude<EmbeddingTask, ''>, string> = {
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
  classification: 'task: classification | query: ',
  clustering: 'task: clustering | query: ',
  similarity: 'task: sentence similarity | query: ',
};

/** What the engines say when an input is over the window (the overflow strategy is "error"). */
const INPUT_TOO_LONG =
  /signature length|exceed|too long|overflow|out of range|longer than|OUT_OF_RANGE|bad_input:/i;

/** A request the node refuses (code goes to `InferenceError.code`). */
export class EmbeddingRequestError extends Error {
  constructor(
    readonly code: 'bad_request' | 'wrong_model_kind',
    message: string,
  ) {
    super(message);
  }
}

export function isEmbeddingTask(task: string): task is EmbeddingTask {
  return task === '' || Object.prototype.hasOwnProperty.call(PREFIX, task);
}

/** The text the engine gets for one input: trimmed, with the task's prefix (none for the empty task). */
export function prefixed(task: EmbeddingTask, input: string): string {
  const text = input.trim();
  return task === '' ? text : PREFIX[task] + text;
}

/** Keeps the first `dims` numbers and scales the result to unit length (Matryoshka truncation). */
export function truncateNormalize(v: ArrayLike<number>, dims: number): number[] {
  const out = Array.from({ length: dims }, (_, i) => v[i] ?? 0);
  let sum = 0;
  for (const x of out) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? out.map((x) => x / norm) : out;
}

export interface EmbeddingJob {
  inputs: string[];
  task: string;
  /** 0 = the full vector. */
  dimensions: number;
}

/**
 * Validates a request, applies the task prefix, embeds all inputs in one engine call and shortens the vectors when
 * `dimensions` asks for fewer than the model makes. Throws `EmbeddingRequestError` for requests the node refuses; any
 * other error is an engine failure.
 */
export async function embedAll(embedder: Embedder, job: EmbeddingJob): Promise<number[][]> {
  if (!isEmbeddingTask(job.task))
    throw new EmbeddingRequestError('bad_request', `Unknown embedding task "${job.task}"`);
  if (job.inputs.length === 0)
    throw new EmbeddingRequestError('bad_request', 'There is nothing to embed');
  if (job.task === '' && job.inputs.some((s) => s.trim() === ''))
    throw new EmbeddingRequestError('bad_request', 'An input is empty');
  const full = embedder.dimension;
  if (job.dimensions > full && full > 0)
    throw new EmbeddingRequestError(
      'bad_request',
      `The model makes ${full} dimensions, ${job.dimensions} were asked for`,
    );
  const task = job.task;
  let vectors;
  try {
    vectors = await embedder.embed(job.inputs.map((s) => prefixed(task, s)));
  } catch (e) {
    // An input over the model's window is the client's mistake, as on every other node type.
    if (INPUT_TOO_LONG.test(String(e)))
      throw new EmbeddingRequestError('bad_request', 'An input is longer than the model accepts');
    throw e;
  }
  if (vectors.length !== job.inputs.length) throw new Error('The engine returned a wrong count');
  // Never hand out NaN or infinity (the gateway would serialise them as null).
  if (vectors.some((v) => Array.from(v).some((x) => !Number.isFinite(x))))
    throw new Error('The engine produced invalid (NaN) vectors');
  return vectors.map((v) =>
    job.dimensions > 0 && job.dimensions < v.length
      ? truncateNormalize(v, job.dimensions)
      : Array.from(v),
  );
}
