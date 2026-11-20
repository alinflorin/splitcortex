import { embedAll, EmbeddingRequestError, prefixed, truncateNormalize } from './embedding';
import type { Embedder } from './types';

function fake(dimension = 4, vec = [3, 4, 0, 0]) {
  const seen: string[][] = [];
  const e: Embedder = {
    loaded: true,
    dimension,
    load: async () => undefined,
    unload: async () => undefined,
    embed: async (texts) => {
      seen.push(texts);
      return texts.map((_, i) => vec.map((x) => x * (i + 1)));
    },
  };
  return { e, seen };
}

describe('prefixed', () => {
  it('trims and writes the model prefix for each task', () => {
    expect(prefixed('query', '  hi ')).toBe('task: search result | query: hi');
    expect(prefixed('document', 'hi')).toBe('title: none | text: hi');
    expect(prefixed('classification', 'hi')).toBe('task: classification | query: hi');
    expect(prefixed('clustering', 'hi')).toBe('task: clustering | query: hi');
    expect(prefixed('similarity', 'hi')).toBe('task: sentence similarity | query: hi');
    expect(prefixed('', '  hi ')).toBe('hi');
  });
});

describe('truncateNormalize', () => {
  it('keeps the first numbers and scales to unit length', () => {
    expect(truncateNormalize([3, 4, 12], 2)).toEqual([0.6, 0.8]);
  });
  it('leaves an all-zero vector alone', () => {
    expect(truncateNormalize([0, 0, 1], 2)).toEqual([0, 0]);
  });
});

describe('embedAll', () => {
  it('embeds every input in one call, in order, with the prefix', async () => {
    const { e, seen } = fake();
    const out = await embedAll(e, { inputs: ['a', 'b'], task: 'document', dimensions: 0 });
    expect(seen).toEqual([['title: none | text: a', 'title: none | text: b']]);
    expect(out).toEqual([
      [3, 4, 0, 0],
      [6, 8, 0, 0],
    ]);
  });
  it('shortens and renormalises when dimensions is below the full size', async () => {
    const { e } = fake();
    const out = await embedAll(e, { inputs: ['a', 'b'], task: '', dimensions: 2 });
    expect(out).toEqual([
      [0.6, 0.8],
      [0.6, 0.8],
    ]);
  });
  it('returns the full vector for dimensions 0 or equal to the full size', async () => {
    const { e } = fake();
    expect((await embedAll(e, { inputs: ['a'], task: '', dimensions: 4 }))[0]).toHaveLength(4);
    expect((await embedAll(e, { inputs: ['a'], task: '', dimensions: 0 }))[0]).toHaveLength(4);
  });
  it('refuses bad input before touching the engine', async () => {
    const { e, seen } = fake();
    for (const job of [
      { inputs: [], task: '', dimensions: 0 },
      { inputs: ['a'], task: 'nope', dimensions: 0 },
      { inputs: ['  '], task: '', dimensions: 0 },
      { inputs: ['a'], task: '', dimensions: 9 },
    ])
      await expect(embedAll(e, job)).rejects.toBeInstanceOf(EmbeddingRequestError);
    expect(seen).toEqual([]);
  });
  it('passes engine failures through', async () => {
    const { e } = fake();
    e.embed = async () => {
      throw new Error('boom');
    };
    await expect(embedAll(e, { inputs: ['a'], task: '', dimensions: 0 })).rejects.toThrow('boom');
  });
});

describe('input over the model window', () => {
  it('is a bad request, not an engine failure; other engine errors stay engine errors', async () => {
    const over: Embedder = {
      ...fake().e,
      embed: async () => {
        throw new Error('input exceeds the maximum length');
      },
    };
    await expect(embedAll(over, { inputs: ['a'], task: '', dimensions: 0 })).rejects.toBeInstanceOf(
      EmbeddingRequestError,
    );
    const broken: Embedder = {
      ...fake().e,
      embed: async () => {
        throw new Error('GPU lost');
      },
    };
    await expect(
      embedAll(broken, { inputs: ['a'], task: '', dimensions: 0 }),
    ).rejects.not.toBeInstanceOf(EmbeddingRequestError);
  });
});

describe('invalid vectors', () => {
  it('never returns NaN: it is an engine failure', async () => {
    const nan: Embedder = { ...fake().e, embed: async () => [new Float32Array([1, NaN, 0, 0])] };
    const e = await embedAll(nan, { inputs: ['a'], task: '', dimensions: 0 }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(EmbeddingRequestError);
  });
});
