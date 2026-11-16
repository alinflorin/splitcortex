import { tauriApi, type NativeApi } from '../native/ipc';

/**
 * Where model files live: the app's data directory, written by the native side. A multi-GB model must never be held in
 * memory and an interrupted download must resume, so writes go in place at an offset and the engine reads the file by
 * name from disk. Everything the model manager needs is this interface, so tests use a fake.
 */
export interface ModelFiles {
  /** Size in bytes, or -1 when the file does not exist. */
  size(name: string): Promise<number>;
  /** Writes `bytes` at `at` (creating the file). */
  write(name: string, at: number, bytes: Uint8Array): Promise<void>;
  truncate(name: string, length: number): Promise<void>;
  /** Lower-case hex SHA-256 of the whole file, computed natively. */
  sha256(name: string): Promise<string>;
  /** Releases the file after writing (nothing to do here: the native side opens a file per write). */
  close(name: string): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export class NativeModelFiles implements ModelFiles {
  constructor(private readonly api: NativeApi = tauriApi) {}
  size = (name: string) => this.api.modelSize(name);
  write = (name: string, at: number, bytes: Uint8Array) => this.api.modelWrite(name, at, bytes);
  truncate = (name: string, length: number) => this.api.modelTruncate(name, length);
  sha256 = (name: string) => this.api.modelSha256(name);
  close = async () => undefined;
  remove = (name: string) => this.api.modelRemove(name);
  list = () => this.api.modelList();
}
