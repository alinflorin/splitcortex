import { describe, expect, it } from 'vitest';
import { uploadParts } from './uploadParts';
import type { PutPart } from './uploadParts';

const plan = { partSize: 4, partCount: 3 };

describe('uploadParts', () => {
  it('slices the file per part and returns etags in part order', async () => {
    const sent: Record<number, number> = {};
    const put: PutPart = async (n, body) => {
      sent[n] = body.size;
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 1)); // finish out of order
      return `etag-${n}`;
    };
    const seen: number[] = [];
    const parts = await uploadParts(new Blob(['0123456789']), plan, {
      put,
      signal: new AbortController().signal,
      onProgress: (n) => seen.push(n),
    });
    expect(sent).toEqual({ 1: 4, 2: 4, 3: 2 });
    expect(parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
    expect(seen.at(-1)).toBe(10);
  });

  it('retries a failing part, then gives up', async () => {
    let calls = 0;
    const flaky: PutPart = async (n) => {
      if (n === 2 && ++calls < 3) throw new Error('boom');
      return 'e';
    };
    const opts = { put: flaky, signal: new AbortController().signal, onProgress: () => {} };
    await expect(
      uploadParts(new Blob(['0123456789']), plan, { ...opts, retries: 3 }),
    ).resolves.toHaveLength(3);

    const dead: PutPart = async () => {
      throw new Error('down');
    };
    await expect(
      uploadParts(new Blob(['0123456789']), plan, { ...opts, put: dead, retries: 1 }),
    ).rejects.toThrow('down');
  });

  it('stops when aborted', async () => {
    const ac = new AbortController();
    const put: PutPart = async () => {
      ac.abort();
      throw new Error('x');
    };
    await expect(
      uploadParts(new Blob(['0123456789']), plan, { put, signal: ac.signal, onProgress: () => {} }),
    ).rejects.toBeTruthy();
  });
});
