import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { nodeAuthorization } from '../protocol/handshake';
import type { Engine } from '../engine/types';
import type { LogBuffer } from '../runtime/log';

const CHUNK = 8 * 1024 * 1024; // same as the control plane's upload part size; each chunk is signed on its own

export interface Assignment {
  modelId: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export type ModelPhaseName = 'none' | 'downloading' | 'loading' | 'ready' | 'failed';
export interface ModelStatus {
  phase: ModelPhaseName;
  modelId: string;
  name: string;
  progressBytes: number;
  sizeBytes: number;
  error?: string;
}
export const NO_MODEL: ModelStatus = {
  phase: 'none',
  modelId: '',
  name: '',
  progressBytes: 0,
  sizeBytes: 0,
};

export interface ModelManagerOptions {
  engine: Engine;
  log: LogBuffer;
  /** Control plane base URL the device enrolled against (includes `/api`). */
  baseUrl: string;
  nodeId: string;
  privateKey: Uint8Array;
  onStatus: (s: ModelStatus) => void;
  /** Injected for tests. */
  fetchFn?: typeof fetch;
  dir?: Directory;
}

/**
 * Keeps the model the gateway assigned to this node's pool on the device: downloads it from the control plane in signed
 * 8 MiB ranges (resumable, a restart continues from the partial file), verifies the SHA-256, replaces the previous
 * model (its file is deleted first to free the disk) and loads it into the engine. Never talks to Hugging Face or to
 * object storage, and never through the gateway.
 */
export class ModelManager {
  private current: AbortController | null = null;
  private chain: Promise<void> = Promise.resolve();
  private status: ModelStatus = NO_MODEL;
  private readonly dir: Directory;

  constructor(private readonly o: ModelManagerOptions) {
    this.dir = o.dir ?? new Directory(Paths.document, 'models');
  }

  /** Applies an assignment; a newer one cancels the one in progress. */
  apply(a: Assignment): Promise<void> {
    this.current?.abort();
    const ctl = new AbortController();
    this.current = ctl;
    this.chain = this.chain.then(() => this.run(a, ctl.signal)).catch(() => undefined);
    return this.chain;
  }

  stop() {
    this.current?.abort();
    this.current = null;
  }

  private set(s: Partial<ModelStatus> & { phase: ModelPhaseName }) {
    this.status = { ...this.status, error: undefined, ...s };
    this.o.onStatus(this.status);
  }

  private async run(a: Assignment, signal: AbortSignal) {
    const { log, engine } = this.o;
    if (signal.aborted) return;
    // Already serving exactly this model (a reconnect re-sends the assignment): just report it again.
    if (
      a.modelId &&
      this.status.modelId === a.modelId &&
      this.status.phase === 'ready' &&
      engine.loaded
    ) {
      this.o.onStatus(this.status);
      return;
    }
    try {
      if (!this.dir.exists) this.dir.create({ intermediates: true });
      if (!a.modelId) {
        await engine.unload();
        this.removeOthers('');
        this.status = NO_MODEL;
        this.o.onStatus(NO_MODEL);
        log.info('The pool serves no model');
        return;
      }
      const final = new File(this.dir, `${a.modelId}.litertlm`);
      if (!(final.exists && final.size === a.sizeBytes)) {
        await engine.unload();
        this.removeOthers(a.modelId); // replace: the old model goes first, there may not be room for two
        await this.download(a, signal);
        if (signal.aborted) return;
      }
      this.set({
        phase: 'loading',
        modelId: a.modelId,
        name: a.name,
        sizeBytes: a.sizeBytes,
        progressBytes: a.sizeBytes,
      });
      log.info(`Loading model ${a.name}`);
      await engine.load(final.uri);
      if (signal.aborted) return;
      this.set({
        phase: 'ready',
        modelId: a.modelId,
        name: a.name,
        sizeBytes: a.sizeBytes,
        progressBytes: a.sizeBytes,
      });
      log.info(`Model ${a.name} is ready`);
    } catch (e) {
      if (signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Model ${a.name || a.modelId} failed: ${message}`);
      this.set({ phase: 'failed', modelId: a.modelId, name: a.name, error: message });
    }
  }

  /** Deletes every model file (and partial download) except the one with this id. */
  private removeOthers(keepId: string) {
    for (const item of this.dir.list()) {
      if (item instanceof File && (!keepId || !item.name.startsWith(`${keepId}.`))) item.delete();
    }
  }

  private async download(a: Assignment, signal: AbortSignal) {
    const { log, baseUrl, nodeId, privateKey } = this.o;
    const doFetch = this.o.fetchFn ?? fetch;
    const part = new File(this.dir, `${a.modelId}.litertlm.part`);
    if (!part.exists) part.create();
    if ((part.size ?? 0) > a.sizeBytes) {
      part.delete();
      part.create();
    }
    const url = `${baseUrl.replace(/\/+$/, '')}/node/models/${a.modelId}/file`;
    const path = new URL(url).pathname;
    let offset = part.size ?? 0;
    log.info(
      `Downloading ${a.name} (${offset > 0 ? `resuming at ${offset} of ` : ''}${a.sizeBytes} bytes)`,
    );
    this.set({
      phase: 'downloading',
      modelId: a.modelId,
      name: a.name,
      sizeBytes: a.sizeBytes,
      progressBytes: offset,
    });
    const handle = part.open(FileMode.ReadWrite);
    let lastReport = 0;
    try {
      while (offset < a.sizeBytes) {
        if (signal.aborted) return;
        const end = Math.min(offset + CHUNK, a.sizeBytes) - 1;
        const res = await doFetch(url, {
          signal,
          headers: {
            Authorization: nodeAuthorization(nodeId, privateKey, 'GET', path),
            Range: `bytes=${offset}-${end}`,
          },
        });
        if (res.status !== 206) throw new Error(`Download failed (HTTP ${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0) throw new Error('Download returned no data');
        handle.offset = offset;
        await handle.writeBytes(bytes);
        offset += bytes.length;
        if (Date.now() - lastReport > 1000) {
          lastReport = Date.now();
          this.set({
            phase: 'downloading',
            modelId: a.modelId,
            name: a.name,
            sizeBytes: a.sizeBytes,
            progressBytes: offset,
          });
        }
      }
    } finally {
      handle.close();
    }
    if (signal.aborted) return;
    if (a.sha256) {
      this.set({
        phase: 'loading',
        modelId: a.modelId,
        name: a.name,
        sizeBytes: a.sizeBytes,
        progressBytes: offset,
      });
      const digest = (await part.digest('SHA-256')).toLowerCase();
      if (digest !== a.sha256.toLowerCase()) {
        part.delete();
        throw new Error('The downloaded file does not match its checksum');
      }
    }
    part.move(new File(this.dir, `${a.modelId}.litertlm`));
    log.info(`Downloaded ${a.name}`);
  }
}
