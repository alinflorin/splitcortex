import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ApiProvider } from '../api/ApiProvider';
import { FeedbackProvider } from '../components/feedback/FeedbackProvider';
import { renderApp } from './render';

/** Stubs `fetch` with `routes` ("METHOD /api/path" -> JSON body) and records the calls. */
export function stubApi(routes: Record<string, unknown>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({ key, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (!(key in routes))
        return new Response(JSON.stringify({ message: `no stub for ${key}` }), { status: 404 });
      const body = routes[key];
      return body === null
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

/** `renderApp` plus the query client and feedback providers. Mock `react-oidc-context` in the test file. */
export function renderWithApi(ui: ReactElement, route = '/') {
  return renderApp(
    <FeedbackProvider>
      <ApiProvider>{ui}</ApiProvider>
    </FeedbackProvider>,
    route,
  );
}
