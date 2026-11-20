import { expect, type APIResponse, type Browser, type Page } from '@playwright/test';
import { accessToken } from './auth';
import { authFile, baseUrl } from './env';

export interface NodeInfo {
  id: string;
  name: string;
  status: string;
  approved: boolean;
  platform: string | null;
}

/** Control plane call as the signed-in user (the page must be on the web app so the token can be read). */
export async function cp(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return page.request.fetch(`${baseUrl()}/api${path}`, {
    method,
    data,
    headers: { authorization: `Bearer ${await accessToken(page)}`, ...headers },
  });
}

/** Status, parsed JSON body (or the text when it is not JSON) and headers of a call. */
export interface Reply<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

async function toReply<T>(res: APIResponse): Promise<Reply<T>> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: keep the text
  }
  return { status: res.status(), body: body as T, headers: res.headers() };
}

/** `cp`, with the answer already read. */
export async function api<T = unknown>(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<Reply<T>> {
  return toReply<T>(await cp(page, method, path, data, headers));
}

/** The OpenAI-shaped error every gateway refusal carries. */
export interface OpenAIError {
  error: { message: string; type: string; code: string | null };
}

/** Gateway call with an optional key (`null`: no Authorization header) and extra headers; never throws on a status. */
export async function gateway<T = unknown>(
  page: Page,
  apiKey: string | null,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply<T>> {
  const res = await page.request.fetch(`${baseUrl()}/v1${path}`, {
    method,
    data: body,
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...headers },
    timeout: 60_000,
  });
  return toReply<T>(res);
}

/** A page of the web app signed in as E2E user `index` (0-based), so `api()` works as that user. */
export async function userPage(browser: Browser, index: number): Promise<Page> {
  const context = await browser.newContext({ storageState: authFile(index) });
  const page = await context.newPage();
  await page.goto(baseUrl());
  return page;
}

/** A short unique suffix for throw-away names. */
export const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-10);

/** Creates a throw-away organisation (the caller is its owner). Delete it with `deleteOrg`. */
export async function createOrg(
  page: Page,
  tag: string,
): Promise<{ id: string; slug: string; name: string }> {
  const slug = `e2e-${tag}-${uniq()}`.slice(0, 40);
  const name = `e2e ${tag} ${slug.slice(-6)}`; // unique, so a left-over of a crashed run is never mistaken for it
  const res = await api<{ id: string }>(page, 'POST', '/organisations', { name, slug });
  expect(res.status, 'create organisation').toBe(201);
  return { id: res.body.id, slug, name };
}

export async function deleteOrg(page: Page, orgId: string) {
  await cp(page, 'DELETE', `/organisations/${orgId}`);
}

export async function poolNodes(page: Page, orgId: string, poolId: string): Promise<NodeInfo[]> {
  const res = await cp(page, 'GET', `/organisations/${orgId}/pools/${poolId}/nodes`);
  if (!res.ok()) throw new Error(`list nodes: ${res.status()}`);
  return (await res.json()) as NodeInfo[];
}

/** OpenAI-format call to the gateway (same origin as the web app, routed by the chart). */
export async function openai(
  page: Page,
  apiKey: string,
  path: string,
  body?: unknown,
): Promise<APIResponse> {
  return page.request.fetch(`${baseUrl()}/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    data: body,
    headers: { authorization: `Bearer ${apiKey}` },
    timeout: 5 * 60_000,
  });
}
