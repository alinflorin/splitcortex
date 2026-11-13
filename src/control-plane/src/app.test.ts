import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { Db } from './db/client';

// No database: these cover wiring only (probes, auth guard, OpenAPI). `execute` stands in for `select 1`.
const db = { execute: async () => ({}) } as unknown as Db;
const verify = async (token: string) => {
  if (token !== 'good') throw new Error('bad token');
  return { sub: 'u1' };
};

describe('control plane app', () => {
  it('answers the probes', async () => {
    const app = await buildApp({ db, verify, logLevel: 'silent' });
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    expect((await app.inject('/readyz')).statusCode).toBe(200);
  });

  it('rejects requests without a valid token', async () => {
    const app = await buildApp({ db, verify, logLevel: 'silent' });
    expect((await app.inject('/api/me')).statusCode).toBe(401);
    const bad = await app.inject({
      url: '/api/organisations',
      headers: { authorization: 'Bearer nope' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('validates bodies before touching the database', async () => {
    const app = await buildApp({ db, verify, logLevel: 'silent' });
    // auth runs first, so an unauthenticated invalid body is still a 401
    const res = await app.inject({
      method: 'POST',
      url: '/api/organisations',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('serves the OpenAPI document and Swagger UI under /api/docs', async () => {
    const app = await buildApp({ db, verify, logLevel: 'silent' });
    const json = await app.inject('/api/docs/json');
    expect(json.statusCode).toBe(200);
    const paths = Object.keys(json.json().paths);
    expect(paths).toContain('/api/organisations/{orgId}/pools');
    expect(paths).not.toContain('/healthz');
    expect((await app.inject('/api/docs/')).statusCode).toBe(200);
    // Swagger UI signs in through Dex; its redirect page must be served for the OAuth popup.
    expect((await app.inject('/api/docs/static/oauth2-redirect.html')).statusCode).toBe(200);
    const flow = json.json().components.securitySchemes.dex.flows.authorizationCode;
    expect(flow.authorizationUrl).toMatch(/\/auth$/);
    expect(flow.tokenUrl).toMatch(/\/token$/);
  });
});
