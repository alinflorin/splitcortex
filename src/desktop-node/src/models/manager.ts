import i18n from 'i18next';
import { httpFetch } from '../native/http';
import { nodeAuthorization } from '../protocol/handshake';
import { kindOf, type ModelKind } from '../engine/embedding';
import type { Embedder, Engine } from '../engine/types';
import type { LogBuffer } from '../runtime/log';
import type { ModelFiles } from './files';

// Each range request is signed on its own (the control plane allows 60 s of clock skew per signature, so a long
// download never expires) and its body is written to storage piece by piece, never held whole.
const CHUNK = 8 * 1024 * 1024;

export interface Assignment {
  modelId: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  /** "" or "chat" (text generation) | "embedding" (loaded into the embedding engine). */
  kind?: string;
}

export type { ModelKind };

export type ModelPhaseName = 'none' | 'downloading' | 'loading' | 'ready' | 'failed';
export interface ModelStatus {
  phase: ModelPhaseName;
  modelId: string;
  name: string;
  progressBytes: number;
  sizeBytes: number;
  /** What the model is for; an embedding model is loaded into the embedder, not the chat engine. */
  kind?: ModelKind;
  /** The vector length of a ready embedding model (0 otherwise). */
  embeddingDimension?: number;
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
  /** The embedding engine; without one an embedding assignment fails. */
  embedder?: Embedder;
  files: ModelFiles;
  log: LogBuffer;
  /** Control plane base URL the device enrolled against (includes `/api`). */
  baseUrl: string;
  nodeId: string;
  privateKey: Uint8Array;
  onStatus: (s: ModelStatus) => void;
  /** Injected for tests. */
  fetchFn?: typeof fetch;
}

const dataFile = (id: string) => `${id}.litertlm`;
/** Written last, once the file is complete and verified: a data file without it is a partial download. */
const doneMarker = (id: string) => `${id}.ok`;

/**
 * Keeps the model the gateway assigned to this node's pool in the browser's storage: downloads it from the control
 * plane in signed ranges (resumable, a reload continues from what is stored), verifies the SHA-256, replaces the
 * previous model (its file is deleted first to free the space) and loads it into the engine. Never talks to Hugging
 * Face or to object storage, and never through the gateway.
 */
export class ModelManager {
  private current: AbortController | null = null;
  private chain: Promise<void> = Promise.resolve();
  private status: ModelStatus = NO_MODEL;

  constructor(private readonly o: ModelManagerOptions) {}

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
    const { log, engine, embedder, files } = this.o;
    if (signal.aborted) return;
    const kind = kindOf(a.kind);
    const loadedNow = kind === 'embedding' ? (embedder?.loaded ?? false) : engine.loaded;
    // Only one kind of model is in memory: whichever is not wanted goes first.
    const unloadAll = async () => {
      await engine.unload();
      await embedder?.unload();
    };
    // Already serving exactly this model (a reconnect re-sends the assignment): just report it again.
    if (
      a.modelId &&
      this.status.modelId === a.modelId &&
      this.status.phase === 'ready' &&
      kindOf(this.status.kind) === kind &&
      loadedNow
    ) {
      this.o.onStatus(this.status);
      return;
    }
    try {
      if (!a.modelId) {
        await unloadAll();
        await this.removeOthers('');
        this.status = NO_MODEL;
        this.o.onStatus(NO_MODEL);
        log.info('The pool serves no model');
        return;
      }
      const name = dataFile(a.modelId);
      const complete =
        (await files.size(doneMarker(a.modelId))) >= 0 && (await files.size(name)) === a.sizeBytes;
      if (!complete) {
        await unloadAll();
        await this.removeOthers(a.modelId); // replace: the old model goes first, there may not be room for two
        await files.remove(doneMarker(a.modelId));
        await this.download(a, signal);
        if (signal.aborted) return;
      }
      this.set({
        phase: 'loading',
        modelId: a.modelId,
        name: a.name,
        kind,
        embeddingDimension: 0,
        sizeBytes: a.sizeBytes,
        progressBytes: a.sizeBytes,
      });
      log.info(`Loading ${kind === 'embedding' ? 'embedding ' : ''}model ${a.name}`);
      if (kind === 'embedding') {
        if (!embedder) throw new Error('This node cannot serve embedding models');
        await engine.unload(); // memory: the chat model goes before the embedding model comes
        await embedder.load(name);
      } else {
        await embedder?.unload();
        await engine.load(name);
      }
      if (signal.aborted) return;
      this.set({
        phase: 'ready',
        modelId: a.modelId,
        name: a.name,
        kind,
        embeddingDimension: kind === 'embedding' ? (embedder?.dimension ?? 0) : 0,
        sizeBytes: a.sizeBytes,
        progressBytes: a.sizeBytes,
      });
      log.info(`Model ${a.name} is ready`);
    } catch (e) {
      if (signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Model ${a.name || a.modelId} failed: ${message}`);
      this.set({ phase: 'failed', modelId: a.modelId, name: a.name, kind, error: message });
    }
  }

  /** Deletes every stored file (and partial download) that does not belong to the model with this id. */
  private async removeOthers(keepId: string) {
    for (const f of await this.o.files.list()) {
      if (!keepId || !f.startsWith(`${keepId}.`)) await this.o.files.remove(f);
    }
  }

  private async download(a: Assignment, signal: AbortSignal) {
    const kind = kindOf(a.kind);
    const { log, files, baseUrl, nodeId, privateKey } = this.o;
    const doFetch = this.o.fetchFn ?? httpFetch;
    const name = dataFile(a.modelId);
    const url = `${baseUrl.replace(/\/+$/, '')}/node/models/${a.modelId}/file`;
    const path = new URL(url).pathname;
    let offset = Math.max(0, await files.size(name));
    if (offset > a.sizeBytes) {
      await files.truncate(name, 0);
      offset = 0;
    }
    log.info(
      `Downloading ${a.name} (${offset > 0 ? `resuming at ${offset} of ` : ''}${a.sizeBytes} bytes)`,
    );
    const report = () =>
      this.set({
        phase: 'downloading',
        modelId: a.modelId,
        name: a.name,
        kind,
        sizeBytes: a.sizeBytes,
        progressBytes: offset,
      });
    report();
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
            'Accept-Language': i18n.language || 'en',
          },
        });
        if (res.status !== 206) throw new Error(`Download failed (HTTP ${res.status})`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('Download returned no data');
        let got = 0;
        try {
          for (;;) {
            if (signal.aborted) return;
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.length > 0) {
              // The storage takes the chunk's buffer over (it is transferred to the worker and `value` goes empty).
              const n = value.length;
              await files.write(name, offset, value);
              offset += n;
              got += n;
              if (Date.now() - lastReport > 1000) {
                lastReport = Date.now();
                report();
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        if (got === 0) throw new Error('Download returned no data');
      }
    } finally {
      await files.close(name); // the engine reads the file next: no write handle may stay open
    }
    if (signal.aborted) return;
    if (a.sha256) {
      this.set({
        phase: 'loading',
        modelId: a.modelId,
        name: a.name,
        kind,
        sizeBytes: a.sizeBytes,
        progressBytes: offset,
      });
      const digest = (await files.sha256(name)).toLowerCase();
      if (digest !== a.sha256.toLowerCase()) {
        await files.remove(name);
        throw new Error('The downloaded file does not match its checksum');
      }
    }
    await files.write(doneMarker(a.modelId), 0, new Uint8Array([1]));
    await files.close(doneMarker(a.modelId));
    log.info(`Downloaded ${a.name}`);
  }
}
