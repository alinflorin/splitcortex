/// <reference lib="webworker" />
import { sha256 } from '@noble/hashes/sha2.js';

// The only code with OPFS synchronous access handles (they exist only in workers). See files.ts.
const handles = new Map<string, FileSystemSyncAccessHandle>();
const HASH_CHUNK = 4 * 1024 * 1024;

async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create: true });
}

async function open(name: string, create: boolean) {
  let h = handles.get(name);
  if (!h) {
    const file = await (await dir()).getFileHandle(name, { create });
    h = await file.createSyncAccessHandle();
    handles.set(name, h);
  }
  return h;
}

function release(name: string) {
  const h = handles.get(name);
  if (!h) return;
  h.flush();
  h.close();
  handles.delete(name);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

async function run(m: Record<string, unknown>): Promise<unknown> {
  const name = m.name as string;
  switch (m.op) {
    case 'size': {
      // A plain read of the size: it must not leave a write handle open (the engine reads the file later).
      const open_ = handles.get(name);
      if (open_) return open_.getSize();
      try {
        return (await (await dir()).getFileHandle(name)).getFile().then((f) => f.size);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return -1;
        throw e;
      }
    }
    case 'write': {
      const h = await open(name, true);
      const bytes = m.bytes as Uint8Array;
      const at = m.at as number;
      let done = 0;
      while (done < bytes.length) done += h.write(bytes.subarray(done), { at: at + done });
      return undefined;
    }
    case 'truncate': {
      const h = await open(name, true);
      h.truncate(m.length as number);
      h.flush();
      return undefined;
    }
    case 'sha256': {
      const h = await open(name, false);
      try {
        const hash = sha256.create();
        const buf = new Uint8Array(HASH_CHUNK);
        const total = h.getSize();
        for (let at = 0; at < total;) {
          const n = h.read(buf.subarray(0, Math.min(HASH_CHUNK, total - at)), { at });
          if (n === 0) break;
          hash.update(buf.subarray(0, n));
          at += n;
        }
        return hex(hash.digest());
      } finally {
        release(name);
      }
    }
    case 'close':
      release(name);
      return undefined;
    case 'remove': {
      release(name);
      try {
        await (await dir()).removeEntry(name);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      }
      return undefined;
    }
    case 'list': {
      const names: string[] = [];
      for await (const key of (await dir()).keys()) names.push(key);
      return names;
    }
    default:
      throw new Error('Unknown operation');
  }
}

self.onmessage = (e: MessageEvent<Record<string, unknown>>) => {
  const id = e.data.id;
  run(e.data).then(
    (result) => self.postMessage({ id, ok: true, result }),
    (err: unknown) =>
      self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
