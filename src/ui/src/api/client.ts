import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Same origin by default (the ingress serves `/api` on the web app host); `VITE_API_URL` for a standalone dev server. */
const base = () => (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Calls the control plane with the Dex access token and validates the response with `schema` (null = no body). */
export async function request<T>(
  token: string | undefined,
  method: Method,
  path: string,
  schema: ZodType<T> | null,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base()}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) message = err.message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  if (!schema) return undefined as T;
  return schema.parse(await res.json());
}

/**
 * PUTs one model upload part (raw bytes) and resolves with its ETag. XHR, because `fetch` cannot report upload
 * progress. Parts pass through the control plane; object storage is never exposed to browsers.
 */
export function putPart(
  token: string | undefined,
  path: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${base()}/api${path}`);
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { etag: string }).etag);
          return;
        } catch {
          // fall through
        }
      }
      let message = `Part upload failed (${xhr.status})`;
      try {
        message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message;
      } catch {
        // not JSON
      }
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
