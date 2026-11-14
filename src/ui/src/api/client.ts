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

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
