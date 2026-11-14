export interface UploadPlan {
  partSize: number;
  partCount: number;
}
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** Uploads one part (raw bytes) and resolves with its ETag. Implemented over XHR in `api/client.ts`. */
export type PutPart = (
  partNumber: number,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
) => Promise<string>;

interface Options {
  put: PutPart;
  concurrency?: number;
  retries?: number;
  signal: AbortSignal;
  /** Total bytes uploaded so far (across parts, including partial parts). */
  onProgress: (uploaded: number) => void;
}

/** Uploads `file` part by part with a few parts in flight and per-part retries. Aborts promptly on `signal`. */
export async function uploadParts(
  file: Blob,
  plan: UploadPlan,
  { put, concurrency = 3, retries = 3, signal, onProgress }: Options,
): Promise<UploadedPart[]> {
  const loaded = new Map<number, number>();
  const report = () => onProgress([...loaded.values()].reduce((a, b) => a + b, 0));
  const results: UploadedPart[] = [];
  const queue = Array.from({ length: plan.partCount }, (_, i) => i + 1);

  const worker = async () => {
    for (let partNumber = queue.shift(); partNumber; partNumber = queue.shift()) {
      const start = (partNumber - 1) * plan.partSize;
      const blob = file.slice(start, Math.min(start + plan.partSize, file.size));
      let attempt = 0;
      for (;;) {
        if (signal.aborted) throw new DOMException('Upload aborted', 'AbortError');
        try {
          const etag = await put(
            partNumber,
            blob,
            (n) => {
              loaded.set(partNumber, n);
              report();
            },
            signal,
          );
          loaded.set(partNumber, blob.size);
          report();
          results.push({ partNumber: partNumber, etag });
          break;
        } catch (err) {
          if (signal.aborted || ++attempt > retries) throw err;
          loaded.set(partNumber, 0);
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.partCount) }, worker));
  return results.sort((a, b) => a.partNumber - b.partNumber);
}
