import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { CompletedPart, ModelStorage } from './types';

/** In-memory storage for tests; also records what was asked of it. */
export function createMemoryStorage(): ModelStorage & {
  objects: Map<string, number>;
  uploads: Map<string, string>;
  /** Bytes received per part, keyed by uploadId. */
  parts: Map<string, Map<number, number>>;
} {
  const objects = new Map<string, number>();
  const uploads = new Map<string, string>(); // uploadId -> key
  const parts = new Map<string, Map<number, number>>();
  return {
    objects,
    uploads,
    parts,
    async createMultipart(key) {
      const uploadId = randomUUID();
      uploads.set(uploadId, key);
      parts.set(uploadId, new Map());
      return { uploadId };
    },
    async uploadPart(_key, uploadId, partNumber, body: Readable) {
      let size = 0;
      for await (const chunk of body) size += (chunk as Buffer).length;
      parts.get(uploadId)!.set(partNumber, size);
      return { etag: `"etag-${partNumber}"` };
    },
    async completeMultipart(key, uploadId, _parts: CompletedPart[]) {
      if (!uploads.delete(uploadId)) throw new Error('NoSuchUpload');
      const sizes = parts.get(uploadId)!;
      objects.set(
        key,
        [...sizes.values()].reduce((a, b) => a + b, 0),
      );
      parts.delete(uploadId);
    },
    async abortMultipart(_key, uploadId) {
      uploads.delete(uploadId);
    },
    async head(key) {
      return objects.has(key) ? { size: objects.get(key)! } : null;
    },
    async put(key, body: Readable) {
      let size = 0;
      for await (const chunk of body) size += (chunk as Buffer).length;
      objects.set(key, size);
      return { size };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
