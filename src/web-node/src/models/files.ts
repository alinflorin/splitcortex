/**
 * Where model files live: the browser's Origin Private File System, in a `models` directory. A multi-GB model must
 * never be held in memory and an interrupted download must resume, so writes go in place at an offset through a
 * dedicated worker (`files.worker.ts`, the only place that has synchronous OPFS access handles) and the engine gets the
 * stored file as a lazily read `File`. Everything the model manager needs is this interface, so tests use a fake.
 */
export interface ModelFiles {
  /** Size in bytes, or -1 when the file does not exist. */
  size(name: string): Promise<number>;
  /** Writes `bytes` at `at` (creating the file). Call `close` when done with a file. */
  write(name: string, at: number, bytes: Uint8Array): Promise<void>;
  truncate(name: string, length: number): Promise<void>;
  /** Lower-case hex SHA-256 of the whole file, computed in the worker. */
  sha256(name: string): Promise<string>;
  /** Releases the write handle (the file can then be opened for reading). */
  close(name: string): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
  /** The stored file for the engine; reads are lazy, the bytes are not copied into memory. */
  openBlob(name: string): Promise<Blob>;
}

type Op = 'size' | 'write' | 'truncate' | 'sha256' | 'close' | 'remove' | 'list';
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** True when this browser can store models (OPFS plus workers). */
export const opfsSupported = () =>
  typeof navigator !== 'undefined' &&
  'storage' in navigator &&
  typeof navigator.storage.getDirectory === 'function' &&
  typeof Worker !== 'undefined';

export class OpfsModelFiles implements ModelFiles {
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, Pending>();

  private call<T>(
    op: Op,
    args: Record<string, unknown> = {},
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./files.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (
        e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
      ) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error ?? 'Storage error'));
      };
    }
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker?.postMessage({ id, op, ...args }, transfer);
    });
  }

  size = (name: string) => this.call<number>('size', { name });
  write = (name: string, at: number, bytes: Uint8Array) => {
    // Copy when the bytes are a view onto a larger buffer: only whole buffers can be transferred.
    const owned =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : bytes.slice();
    return this.call<void>('write', { name, at, bytes: owned }, [owned.buffer as ArrayBuffer]);
  };
  truncate = (name: string, length: number) => this.call<void>('truncate', { name, length });
  sha256 = (name: string) => this.call<string>('sha256', { name });
  close = (name: string) => this.call<void>('close', { name });
  remove = (name: string) => this.call<void>('remove', { name });
  list = () => this.call<string[]>('list');

  async openBlob(name: string): Promise<Blob> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('models');
    return (await dir.getFileHandle(name)).getFile();
  }
}
