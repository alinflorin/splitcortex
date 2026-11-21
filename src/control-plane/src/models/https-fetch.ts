import { request } from 'node:https';
import { Readable } from 'node:stream';

/**
 * Minimal `fetch` for the model mirror, built on `node:https`. Node's built-in fetch (undici) streams a
 * multi-GiB body at a few MB/s here (3 vs 55 MB/s for the same URL), so large downloads avoid it. Only what
 * the mirror needs: GET, headers, abort signal, redirects are returned as-is (the caller follows them).
 */
export const httpsFetch: typeof fetch = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const url =
      input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const req = request(
      url,
      { method: 'GET', headers, signal: init?.signal ?? undefined },
      (res) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers))
          if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v);
        const status = res.statusCode ?? 0;
        const empty = status === 204 || status === 304 || (status >= 300 && status < 400);
        if (empty) res.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
            status,
            headers: out,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
