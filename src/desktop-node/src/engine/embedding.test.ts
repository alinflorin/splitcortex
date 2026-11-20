import { describe, expect, it, vi } from 'vitest';
import { applyDimensions, EmbeddingInputError, embedTexts, prefixInput } from './embedding';
import type { Embedder } from './types';

const fake = (vectors: number[][] = [[3, 4, 0, 0]]): Embedder => ({
  loaded: true,
  dimension: 4,
  load: vi.fn(),
  unload: vi.fn(),
  embed: vi.fn(async (inputs: string[]) => ({
    vectors: inputs.map((_, i) => vectors[i % vectors.length]!),
    promptTokens: 0,
  })),
});

describe('prefixInput', () => {
  it('writes the EmbeddingGemma prefix for each task after trimming', () => {
    expect(prefixInput('query', '  what?\n')).toBe('task: search result | query: what?');
    expect(prefixInput('document', 'text')).toBe('title: none | text: text');
    expect(prefixInput('classification', 'x')).toBe('task: classification | query: x');
    expect(prefixInput('clustering', 'x')).toBe('task: clustering | query: x');
    expect(prefixInput('similarity', 'x')).toBe('task: sentence similarity | query: x');
    expect(prefixInput('', ' x ')).toBe('x');
  });
  it('rejects an unknown task', () => {
    expect(() => prefixInput('poem', 'x')).toThrow(EmbeddingInputError);
  });
});

describe('applyDimensions', () => {
  it('truncates and renormalises', () => {
    const v = applyDimensions([3, 4, 12], 2);
    expect(v).toEqual([0.6, 0.8]);
  });
  it('leaves the vector alone for 0 or a size that is not smaller', () => {
    const v = [1, 0, 0];
    expect(applyDimensions(v, 0)).toBe(v);
    expect(applyDimensions(v, 3)).toBe(v);
    expect(applyDimensions(v, 99)).toBe(v);
  });
  it('does not divide by zero', () => {
    expect(applyDimensions([0, 0, 1], 2)).toEqual([0, 0]);
  });
});

describe('embedTexts', () => {
  it('prefixes every input, keeps the order and applies dimensions', async () => {
    const e = fake([
      [3, 4, 0, 0],
      [0, 0, 1, 0],
    ]);
    const out = await embedTexts(e, [' a ', 'b'], 'document', 2);
    expect(e.embed).toHaveBeenCalledWith(['title: none | text: a', 'title: none | text: b']);
    expect(out.vectors).toEqual([
      [0.6, 0.8],
      [0, 0],
    ]);
  });
  it('rejects no inputs and blank inputs', async () => {
    await expect(embedTexts(fake(), [], '', 0)).rejects.toBeInstanceOf(EmbeddingInputError);
    await expect(embedTexts(fake(), ['a', '  '], '', 0)).rejects.toBeInstanceOf(
      EmbeddingInputError,
    );
  });
  it('fails when the engine returns the wrong number of vectors', async () => {
    const e = fake();
    vi.mocked(e.embed).mockResolvedValueOnce({ vectors: [], promptTokens: 0 });
    await expect(embedTexts(e, ['a'], '', 0)).rejects.toThrow(/different number/);
  });
});

describe('input over the model window', () => {
  it('is an input error, not an engine failure; other engine errors stay engine errors', async () => {
    const over = {
      ...fake(),
      embed: vi.fn(async () => {
        throw 'bad_input: embedding: input is out of range';
      }),
    };
    await expect(embedTexts(over, ['a'], '', 0)).rejects.toBeInstanceOf(EmbeddingInputError);
    const broken = {
      ...fake(),
      embed: vi.fn(async () => {
        throw new Error('GPU lost');
      }),
    };
    await expect(embedTexts(broken, ['a'], '', 0)).rejects.not.toBeInstanceOf(EmbeddingInputError);
  });
});
