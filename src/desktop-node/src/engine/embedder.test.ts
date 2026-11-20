import { describe, expect, it, vi } from 'vitest';
import type { NativeApi } from '../native/ipc';
import { NativeEmbedder } from './embedder';

const api = () =>
  ({
    embedderLoad: vi.fn(async () => ({ dimension: 768 })),
    embedderUnload: vi.fn(async () => undefined),
    embedderEmbed: vi.fn(async (inputs: string[]) => inputs.map(() => [1])),
  }) as unknown as NativeApi;

describe('NativeEmbedder', () => {
  it('loads, reports the dimension, embeds and unloads', async () => {
    const a = api();
    const e = new NativeEmbedder(a);
    await expect(e.embed(['x'])).rejects.toThrow();
    await e.load('e.litertlm');
    expect(e).toMatchObject({ loaded: true, dimension: 768 });
    await expect(e.embed(['x', 'y'])).resolves.toEqual({ vectors: [[1], [1]], promptTokens: 0 });
    await e.unload();
    expect(e).toMatchObject({ loaded: false, dimension: 0 });
  });

  it('passes the backend asked for to the native side', async () => {
    const a = api();
    await new NativeEmbedder(a, () => 'gpu').load('e.litertlm');
    expect(a.embedderLoad).toHaveBeenCalledWith('e.litertlm', 'gpu');
  });
});
