import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engine/types';
import { LogBuffer } from '../runtime/log';
import type { ModelFiles } from './files';
import { ModelManager, type ModelStatus } from './manager';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** In-memory stand-in for the OPFS-backed storage. */
function memoryFiles() {
  const disk = new Map<string, Uint8Array>();
  const files: ModelFiles = {
    size: async (n) => disk.get(n)?.length ?? -1,
    write: async (n, at, bytes) => {
      const data = bytes.slice();
      // Like the real storage, take the buffer over: the caller's array is empty afterwards.
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
      bytes = data;
      const cur = disk.get(n) ?? new Uint8Array();
      const out = new Uint8Array(Math.max(cur.length, at + bytes.length));
      out.set(cur);
      out.set(bytes, at);
      disk.set(n, out);
    },
    truncate: async (n, len) => void disk.set(n, (disk.get(n) ?? new Uint8Array()).slice(0, len)),
    sha256: async (n) => hex(sha256(disk.get(n)!)),
    close: async () => undefined,
    remove: async (n) => void disk.delete(n),
    list: async () => [...disk.keys()],
  };
  return { disk, files };
}

const FILE = Uint8Array.from({ length: 20_000_000 }, (_, i) => i % 251);
const HASH = hex(sha256(FILE));
const assignment = (over = {}) => ({
  modelId: 'm1',
  name: 'gemma',
  fileName: 'g.litertlm',
  sizeBytes: FILE.length,
  sha256: HASH,
  ...over,
});

function setup(fileBytes: Uint8Array = FILE) {
  const { disk, files } = memoryFiles();
  const statuses: ModelStatus[] = [];
  const engine: Engine = {
    modalities: [],
    backend: null,
    maxContextTokens: 0,
    capabilities: async () => ({ gpuAvailable: false, emulator: false, totalMemoryMb: 0 }),
    benchmark: async () => 0,
    loaded: false,
    load: vi.fn(async () => {
      (engine as { loaded: boolean }).loaded = true;
    }),
    unload: vi.fn(async () => {
      (engine as { loaded: boolean }).loaded = false;
    }),
    generate: vi.fn(),
  };
  const ranges: string[] = [];
  const auth: string[] = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    ranges.push(h.Range!);
    auth.push(h.Authorization!);
    const [s, e] = h.Range!.replace('bytes=', '').split('-').map(Number);
    return new Response(fileBytes.slice(s!, e! + 1), { status: 206 });
  }) as unknown as typeof fetch;
  const mgr = new ModelManager({
    engine,
    files,
    log: new LogBuffer(),
    baseUrl: 'https://web.test/api/',
    nodeId: 'n1',
    privateKey: ed25519.utils.randomSecretKey(),
    onStatus: (s) => statuses.push(s),
    fetchFn,
  });
  return { mgr, engine, statuses, ranges, auth, disk };
}

describe('ModelManager', () => {
  it('downloads in signed ranges, verifies the checksum, then loads the model', async () => {
    const { mgr, engine, statuses, ranges, auth, disk } = setup();
    await mgr.apply(assignment());
    expect(ranges).toEqual([
      'bytes=0-8388607',
      'bytes=8388608-16777215',
      'bytes=16777216-19999999',
    ]);
    expect(auth.every((a) => a.startsWith('Node n1.'))).toBe(true);
    expect(engine.load).toHaveBeenCalledWith('m1.litertlm');
    expect(statuses.at(-1)).toMatchObject({ phase: 'ready', modelId: 'm1' });
    expect([...disk.keys()].sort()).toEqual(['m1.litertlm', 'm1.ok']);
  });

  it('resumes a partial download', async () => {
    const { mgr, ranges, disk } = setup();
    disk.set('m1.litertlm', FILE.slice(0, 8388608));
    await mgr.apply(assignment());
    expect(ranges[0]).toBe('bytes=8388608-16777215');
  });

  it('does not download a complete, verified file again', async () => {
    const { mgr, engine, ranges, disk } = setup();
    disk.set('m1.litertlm', FILE);
    disk.set('m1.ok', new Uint8Array([1]));
    await mgr.apply(assignment());
    expect(ranges).toEqual([]);
    expect(engine.load).toHaveBeenCalledWith('m1.litertlm');
  });

  it('rejects a file that does not match its checksum and deletes it', async () => {
    const bad = FILE.slice();
    bad[5] = bad[5]! ^ 1;
    const { mgr, engine, statuses, disk } = setup(bad);
    await mgr.apply(assignment());
    expect(engine.load).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ phase: 'failed' });
    expect(disk.size).toBe(0);
  });

  it('replaces the previous model: the old files are deleted and the engine reloaded', async () => {
    const { mgr, engine, disk } = setup();
    disk.set('old.litertlm', new Uint8Array(3));
    disk.set('old.ok', new Uint8Array(1));
    await mgr.apply(assignment());
    expect([...disk.keys()].some((k) => k.startsWith('old.'))).toBe(false);
    expect(engine.unload).toHaveBeenCalled();
  });

  it('removes everything when the pool serves no model, and re-reports an already ready model without reloading', async () => {
    const { mgr, engine, statuses, disk } = setup();
    await mgr.apply(assignment());
    vi.mocked(engine.load).mockClear();
    await mgr.apply(assignment()); // a reconnect re-sends the assignment
    expect(engine.load).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ phase: 'ready' });
    await mgr.apply({ modelId: '', name: '', fileName: '', sizeBytes: 0, sha256: '' });
    expect(disk.size).toBe(0);
    expect(statuses.at(-1)).toMatchObject({ phase: 'none' });
  });
});
