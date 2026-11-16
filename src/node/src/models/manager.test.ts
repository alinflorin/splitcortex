import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { LogBuffer } from '../runtime/log';
import type { Engine } from '../engine/types';
import { ModelManager, type ModelStatus } from './manager';

// In-memory stand-in for the parts of expo-file-system the manager uses.
const mockDisk = new Map<string, Uint8Array>();
jest.mock('expo-file-system', () => {
  class Item {
    uri: string;
    constructor(...p: (string | Item)[]) {
      this.uri = p.map((x) => (typeof x === 'string' ? x : x.uri)).join('/');
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
  }
  class File extends Item {
    get exists() {
      return mockDisk.has(this.uri);
    }
    get size() {
      return mockDisk.get(this.uri)?.length ?? null;
    }
    create() {
      mockDisk.set(this.uri, new Uint8Array());
    }
    delete() {
      mockDisk.delete(this.uri);
    }
    move(dest: File) {
      mockDisk.set(dest.uri, mockDisk.get(this.uri)!);
      mockDisk.delete(this.uri);
    }
    async digest() {
      const h = require('@noble/hashes/sha2.js').sha256(mockDisk.get(this.uri)!) as Uint8Array;
      return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    open() {
      const uri = this.uri;
      return {
        offset: 0,
        close() {},
        async writeBytes(this: { offset: number }, b: Uint8Array) {
          const cur = mockDisk.get(uri) ?? new Uint8Array();
          const out = new Uint8Array(Math.max(cur.length, this.offset + b.length));
          out.set(cur);
          out.set(b, this.offset);
          mockDisk.set(uri, out);
        },
      };
    }
  }
  class Directory extends Item {
    exists = true;
    create() {}
    list() {
      return [...mockDisk.keys()]
        .filter((k) => k.startsWith(this.uri + '/'))
        .map((k) => new File(k));
    }
  }
  return {
    File,
    Directory,
    Paths: { document: new Directory('doc') },
    FileMode: { ReadWrite: 'rw' },
  };
});

import { Directory } from 'expo-file-system';

const FILE = Uint8Array.from({ length: 20_000_000 }, (_, i) => i % 251);
const HASH = Array.from(sha256(FILE), (b) => b.toString(16).padStart(2, '0')).join('');
const assignment = (over = {}) => ({
  modelId: 'm1',
  name: 'gemma',
  fileName: 'g.litertlm',
  sizeBytes: FILE.length,
  sha256: HASH,
  ...over,
});

function setup(fileBytes: Uint8Array = FILE) {
  mockDisk.clear();
  const statuses: ModelStatus[] = [];
  const engine: Engine = {
    loaded: false,
    load: jest.fn(async () => {
      (engine as { loaded: boolean }).loaded = true;
    }),
    unload: jest.fn(async () => {
      (engine as { loaded: boolean }).loaded = false;
    }),
    generate: jest.fn(),
  };
  const ranges: string[] = [];
  const auth: string[] = [];
  const fetchFn = jest.fn(async (_url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    ranges.push(h.Range!);
    auth.push(h.Authorization!);
    const [s, e] = h.Range!.replace('bytes=', '').split('-').map(Number);
    return new Response(fileBytes.slice(s!, e! + 1), { status: 206 });
  }) as unknown as typeof fetch;
  const mgr = new ModelManager({
    engine,
    log: new LogBuffer(),
    baseUrl: 'https://app.test/api/',
    nodeId: 'n1',
    privateKey: ed25519.utils.randomSecretKey(),
    onStatus: (s) => statuses.push(s),
    fetchFn,
    dir: new Directory('doc/models'),
  });
  return { mgr, engine, statuses, ranges, auth, fetchFn };
}

describe('ModelManager', () => {
  it('downloads in signed ranges, verifies the checksum, then loads the model', async () => {
    const { mgr, engine, statuses, ranges, auth } = setup();
    await mgr.apply(assignment());
    expect(ranges).toEqual([
      'bytes=0-8388607',
      'bytes=8388608-16777215',
      'bytes=16777216-19999999',
    ]);
    expect(new Set(auth).size).toBeGreaterThan(0);
    expect(auth.every((a) => a.startsWith('Node n1.'))).toBe(true);
    expect(engine.load).toHaveBeenCalledWith('doc/models/m1.litertlm');
    expect(statuses.at(-1)).toMatchObject({ phase: 'ready', modelId: 'm1' });
    expect(mockDisk.has('doc/models/m1.litertlm.part')).toBe(false);
  });

  it('resumes a partial download', async () => {
    const { mgr, ranges } = setup();
    mockDisk.set('doc/models/m1.litertlm.part', FILE.slice(0, 8388608));
    await mgr.apply(assignment());
    expect(ranges[0]).toBe('bytes=8388608-16777215');
  });

  it('rejects a file that does not match its checksum and deletes it', async () => {
    const bad = FILE.slice();
    bad[5] ^= 1;
    const { mgr, engine, statuses } = setup(bad);
    await mgr.apply(assignment());
    expect(engine.load).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ phase: 'failed' });
    expect(mockDisk.size).toBe(0);
  });

  it('replaces the previous model: the old file is deleted and the engine reloaded', async () => {
    const { mgr, engine } = setup();
    mockDisk.set('doc/models/old.litertlm', new Uint8Array(3));
    await mgr.apply(assignment());
    expect(mockDisk.has('doc/models/old.litertlm')).toBe(false);
    expect(engine.unload).toHaveBeenCalled();
  });

  it('removes everything when the pool serves no model, and re-reports an already ready model without reloading', async () => {
    const { mgr, engine, statuses } = setup();
    await mgr.apply(assignment());
    (engine.load as jest.Mock).mockClear();
    await mgr.apply(assignment()); // a reconnect re-sends the assignment
    expect(engine.load).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ phase: 'ready' });
    await mgr.apply({ modelId: '', name: '', fileName: '', sizeBytes: 0, sha256: '' });
    expect(mockDisk.size).toBe(0);
    expect(statuses.at(-1)).toMatchObject({ phase: 'none' });
  });
});
