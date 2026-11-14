import type { Readable } from 'node:stream';

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** Object storage for model files (S3 API; Garage in the chart). Everything is keyed by the object key. */
export interface ModelStorage {
  createMultipart(key: string): Promise<{ uploadId: string }>;
  /** Streams one part (exactly `size` bytes) into a multipart upload; resolves with the part's ETag. */
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    size: number,
  ): Promise<{ etag: string }>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Size of the stored object, or null when it does not exist. */
  head(key: string): Promise<{ size: number } | null>;
  /** Streams `body` into the bucket, reporting bytes as they go. Resolves with the final size. */
  put(key: string, body: Readable, opts?: { signal?: AbortSignal }): Promise<{ size: number }>;
  delete(key: string): Promise<void>;
}
