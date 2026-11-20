import { describe, expect, it, vi } from 'vitest';
import { EmbeddingRequestError, prepareInputs, runEmbedding, shrink } from './embedding';
import type { Embedder } from './types';

const fake = (vectors: number[][], promptTokens = 0): Embedder & { seen: string[][] } => {
  const seen: string[][] = [];
  return {
    loaded: true,
    dimension: vectors[0]?.length ?? 0,
    load: vi.fn(),
    unload: vi.fn(),
    embed: async (texts) => {
      seen.push(texts);
      return { vectors: texts.map((_, i) => vectors[i % vectors.length]!), promptTokens };
    },
    seen,
  };
};

describe('task prefixes', () => {
  it('writes the EmbeddingGemma prefix for the task, after trimming', () => {
    const t = ['  hi  '];
    expect(prepareInputs(t, 'query')).toEqual(['task: search result | query: hi']);
    expect(prepareInputs(t, 'document')).toEqual(['title: none | text: hi']);
    expect(prepareInputs(t, 'classification')).toEqual(['task: classification | query: hi']);
    expect(prepareInputs(t, 'clustering')).toEqual(['task: clustering | query: hi']);
    expect(prepareInputs(t, 'similarity')).toEqual(['task: sentence similarity | query: hi']);
    expect(prepareInputs(t, '')).toEqual(['hi']);
  });

  it('rejects an unknown task and an empty list', () => {
    expect(() => prepareInputs(['a'], 'nope')).toThrow(EmbeddingRequestError);
    expect(() => prepareInputs([], '')).toThrow(EmbeddingRequestError);
  });
});

describe('dimensions', () => {
  it('truncates and renormalises only when smaller than the vector', () => {
    const out = shrink([3, 4, 12], 2);
    expect(out).toHaveLength(2);
    expect(Math.hypot(...out)).toBeCloseTo(1);
    expect(out[0]).toBeCloseTo(0.6);
    expect(shrink([3, 4, 12], 0)).toEqual([3, 4, 12]);
    expect(shrink([3, 4, 12], 3)).toEqual([3, 4, 12]);
    expect(shrink([3, 4, 12], 99)).toEqual([3, 4, 12]);
  });
});

describe('runEmbedding', () => {
  it('prefixes, embeds in one batch, shrinks and keeps the order and token count', async () => {
    const e = fake(
      [
        [1, 0, 0],
        [0, 3, 4],
      ],
      7,
    );
    const out = await runEmbedding(e, { inputs: ['a', 'b'], task: 'query', dimensions: 2 });
    expect(e.seen).toEqual([['task: search result | query: a', 'task: search result | query: b']]);
    expect(out.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(out.promptTokens).toBe(7);
  });

  it('fails when the engine returns the wrong number of vectors', async () => {
    const e = fake([[1]]);
    e.embed = async () => ({ vectors: [], promptTokens: 0 });
    await expect(runEmbedding(e, { inputs: ['a'], task: '', dimensions: 0 })).rejects.toThrow();
  });
});
