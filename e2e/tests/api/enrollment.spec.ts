import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';

// The device-facing enrollment protocol (`/enroll/start`) and the admin side of codes, without any node: a client
// would have to speak CPace, but the limits around it can be checked with garbage shares.
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

const start = (code: string) =>
  fetch(`${apiUrl}/enroll/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      lookupId: code.slice(0, 4),
      sid: randomBytes(16).toString('base64url'),
      share: randomBytes(32).toString('base64url'),
    }),
  });

test('a code lasts about ten minutes and allows three guesses', async () => {
  const { enrollment } = await ws.cp.createEnrollment(ws.org.id, ws.pool.id);
  expect(enrollment.maxAttempts).toBe(3);
  const minutes = (Date.parse(enrollment.expiresAt) - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(8);
  expect(minutes).toBeLessThanOrEqual(10.5);
});

test('guesses are counted and stop at the limit, with the same generic answer', async () => {
  const { enrollment, code } = await ws.cp.createEnrollment(ws.org.id, ws.pool.id);
  const unknown = await start('0000-000000');
  expect(unknown.status).toBe(404);
  const unknownBody = await unknown.text();
  for (let i = 0; i < 4; i++) {
    const res = await start(code);
    // A garbage share is no group element: a failure that looks like an unknown code.
    expect([200, 404]).toContain(res.status);
    if (res.status === 404) expect(await res.text()).toBe(unknownBody);
  }
  const listed = (await ws.cp.listEnrollments(ws.org.id, ws.pool.id)).find(
    (e) => e.id === enrollment.id,
  );
  expect(listed?.attempts).toBe(3);
  // Used up: a further guess is refused and not counted.
  expect((await start(code)).status).toBe(404);
});

test('a cancelled code is refused like an unknown one', async () => {
  const { enrollment, code } = await ws.cp.createEnrollment(ws.org.id, ws.pool.id);
  await ws.cp.cancelEnrollment(ws.org.id, enrollment.id);
  expect((await start(code)).status).toBe(404);
  const active = await ws.cp.listEnrollments(ws.org.id, ws.pool.id);
  expect(active.find((e) => e.id === enrollment.id)).toBeUndefined();
});

test('the list of active codes never contains a code', async () => {
  const { code } = await ws.cp.createEnrollment(ws.org.id, ws.pool.id);
  const res = await ws.cp.send(
    'GET',
    `/organisations/${ws.org.id}/pools/${ws.pool.id}/enrollments`,
  );
  expect(res.status).toBe(200);
  const text = JSON.stringify(res.body);
  expect(text).not.toContain(code);
  expect(text).not.toContain(code.slice(5));
});

test('a malformed request is rejected', async () => {
  const res = await fetch(`${apiUrl}/enroll/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lookupId: 'x', sid: 'a', share: 'b' }),
  });
  expect(res.status).toBe(400);
});
