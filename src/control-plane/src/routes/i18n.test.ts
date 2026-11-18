import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/harness';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const missingOrg = (lang?: string) =>
  t.app.inject({
    method: 'GET',
    url: '/api/organisations/00000000-0000-4000-8000-000000000000',
    headers: { ...t.as('a@x.io'), ...(lang ? { 'accept-language': lang } : {}) },
  });

describe('error translation', () => {
  it('answers in English by default and in Romanian on request', async () => {
    const en = await missingOrg();
    expect(en.statusCode).toBe(404);
    expect(en.json().message).toBe('Organisation not found');
    expect(en.headers['content-language']).toBe('en');

    const ro = await missingOrg('ro-RO,ro;q=0.9');
    expect(ro.statusCode).toBe(404);
    expect(ro.json().message).toBe('Organizația nu a fost găsită');
    expect(ro.headers['content-language']).toBe('ro');
  });

  it('translates the missing token error', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/organisations',
      headers: { 'accept-language': 'ro' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Lipsește token-ul bearer');
  });
});
