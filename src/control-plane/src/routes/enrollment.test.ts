import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { cpace } from '@cipherman/pake-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { configChanges, enrollments, nodes } from '../db/schema';
import { POP_LABEL, b64, fingerprint, open, parseCode, seal, unb64 } from '../enrollment/crypto';
import { createTestApp } from '../test/harness';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  user: string,
  payload?: object,
) => t.app.inject({ method, url: `/api${url}`, headers: t.as(user), payload });
const post = (url: string, payload: object) =>
  t.app.inject({ method: 'POST', url: `/api${url}`, payload });

async function setup(slug: string, requireApproval = false) {
  const org = (await call('POST', '/organisations', 'own@k.io', { name: slug, slug })).json<{
    id: string;
  }>().id;
  const pool = (await call('POST', `/organisations/${org}/pools`, 'own@k.io', { name: 'p' })).json<{
    id: string;
  }>().id;
  if (requireApproval) {
    await call('PATCH', `/organisations/${org}/pools/${pool}`, 'own@k.io', {
      requireApproval: true,
    });
  }
  return { org, pool };
}

const enc = new TextEncoder();

/** A minimal device: generates an Ed25519 key and runs the two PAKE rounds. */
async function enrol(
  code: string,
  opts: { keyPair?: { publicKey: KeyObject; privateKey: KeyObject } } = {},
) {
  const parsed = parseCode(code)!;
  const kp = opts.keyPair ?? generateKeyPairSync('ed25519');
  const spki = kp.publicKey.export({ format: 'der', type: 'spki' });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
  const sid = new Uint8Array(randomBytes(16));
  const me = cpace.ristretto255.init({
    PRS: enc.encode(`splitcortex-enroll-v1:${parsed.secret}`),
    sid,
    CI: enc.encode('splitcortex-enroll-v1'),
  });
  const start = await post('/enroll/start', {
    lookupId: parsed.lookupId,
    sid: b64(sid),
    share: b64(me.share),
  });
  if (start.statusCode !== 200) return { start };
  const isk = cpace.ristretto255.deriveIskInitiatorResponder({
    ephemeralSecret: me.ephemeralSecret,
    ownShare: me.share,
    peerShare: unb64(start.json<{ share: string }>().share),
    ownAD: enc.encode('device'),
    peerAD: enc.encode('server'),
    sid,
    role: 'initiator',
  });
  const plain = {
    publicKey: b64(publicKey),
    signature: b64(sign(null, Buffer.concat([POP_LABEL, sid]), kp.privateKey)),
    deviceModel: 'Pixel 9',
    platform: 'android',
    cpuCores: 8,
  };
  const complete = await post('/enroll/complete', {
    lookupId: parsed.lookupId,
    sealed: b64(seal(isk, sid, 'request', enc.encode(JSON.stringify(plain)))),
  });
  const body =
    complete.statusCode === 200
      ? JSON.parse(
          new TextDecoder().decode(
            open(isk, sid, 'response', unb64(complete.json<{ sealed: string }>().sealed))!,
          ),
        )
      : null;
  return { start, complete, body, publicKey };
}

const create = async (org: string, pool: string, user = 'own@k.io') =>
  call('POST', `/organisations/${org}/pools/${pool}/enrollments`, user);

describe('code helpers', () => {
  it('normalises typed codes', () => {
    expect(parseCode('k7m2-qx9h4t')).toEqual({ lookupId: 'K7M2', secret: 'QX9H4T' });
    expect(parseCode('O0I1-L1O0AB')).toEqual({ lookupId: '0011', secret: '1100AB' });
    expect(parseCode('short')).toBeNull();
    expect(parseCode('ABCD-EFGU12')).toBeNull(); // U is not in the alphabet
  });

  it('fingerprints are stable and formatted', () => {
    const fp = fingerprint(new Uint8Array(32));
    expect(fp).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // Shared vector: the phone app's tests assert the same values.
    expect(fp).toBe('CSM7-NBFR-CAYQ');
    expect(fingerprint(new Uint8Array(32).fill(7))).toBe('9ER6-Z3JE-79VH');
    expect(fingerprint(new Uint8Array(32).fill(1))).not.toBe(fp);
  });
});

describe('enrollment', () => {
  it('registers a device with the right code, then the code is dead', async () => {
    const { org, pool } = await setup('e-ok');
    const created = await create(org, pool);
    expect(created.statusCode).toBe(201);
    const { code } = created.json<{ code: string }>();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{6}$/);

    const r = await enrol(code);
    expect(r.complete?.statusCode).toBe(200);
    expect(r.body).toMatchObject({ approved: true, gateway: null });
    const [node] = await t.db.select().from(nodes).where(eq(nodes.id, r.body.nodeId));
    expect(node).toMatchObject({
      orgId: org,
      poolId: pool,
      deviceModel: 'Pixel 9',
      approved: true,
    });
    expect(node!.fingerprint).toBe(r.body.fingerprint);
    // The gateway feed learns about the new node.
    const changes = await t.db
      .select()
      .from(configChanges)
      .where(eq(configChanges.entityId, node!.id));
    expect(changes).toHaveLength(1);

    // Single use.
    const again = await enrol(code);
    expect(again.start.statusCode).toBe(404);
    expect(await t.db.select().from(enrollments).where(eq(enrollments.orgId, org))).toHaveLength(0);
  });

  it('puts the device in pending when the pool requires approval', async () => {
    const { org, pool } = await setup('e-appr', true);
    const { code } = (await create(org, pool)).json<{ code: string }>();
    const r = await enrol(code);
    expect(r.body.approved).toBe(false);
    const list = await call('GET', `/organisations/${org}/pools/${pool}/nodes`, 'own@k.io');
    expect(list.json<{ status: string }[]>()[0]!.status).toBe('pending');
  });

  it('rejects a wrong secret and kills the code after the attempt limit', async () => {
    const { org, pool } = await setup('e-bad');
    const { code } = (await create(org, pool)).json<{ code: string }>();
    const lookup = code.slice(0, 4);
    const real = parseCode(code)!.secret;
    const guess = real === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
    for (let i = 0; i < 3; i++) {
      const r = await enrol(`${lookup}-${guess}`);
      expect(r.complete?.statusCode).toBe(404);
    }
    // Exhausted: even the right code is refused now.
    const r = await enrol(code);
    expect(r.start.statusCode).toBe(404);
    expect(await t.db.select().from(nodes).where(eq(nodes.orgId, org))).toHaveLength(0);
  });

  it('refuses expired codes', async () => {
    const { org, pool } = await setup('e-exp');
    const { code } = (await create(org, pool)).json<{ code: string }>();
    await t.db
      .update(enrollments)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(enrollments.orgId, org));
    expect((await enrol(code)).start.statusCode).toBe(404);
  });

  it('rejects a key the device cannot prove it holds', async () => {
    const { org, pool } = await setup('e-pop');
    const { code } = (await create(org, pool)).json<{ code: string }>();
    const parsed = parseCode(code)!;
    const kp = generateKeyPairSync('ed25519');
    const other = generateKeyPairSync('ed25519');
    const spki = kp.publicKey.export({ format: 'der', type: 'spki' });
    const sid = new Uint8Array(randomBytes(16));
    const me = cpace.ristretto255.init({
      PRS: enc.encode(`splitcortex-enroll-v1:${parsed.secret}`),
      sid,
      CI: enc.encode('splitcortex-enroll-v1'),
    });
    const start = await post('/enroll/start', {
      lookupId: parsed.lookupId,
      sid: b64(sid),
      share: b64(me.share),
    });
    const isk = cpace.ristretto255.deriveIskInitiatorResponder({
      ephemeralSecret: me.ephemeralSecret,
      ownShare: me.share,
      peerShare: unb64(start.json<{ share: string }>().share),
      ownAD: enc.encode('device'),
      peerAD: enc.encode('server'),
      sid,
      role: 'initiator',
    });
    const plain = {
      publicKey: b64(new Uint8Array(spki.subarray(spki.length - 32))),
      // signed by a different key
      signature: b64(sign(null, Buffer.concat([POP_LABEL, sid]), other.privateKey)),
    };
    const complete = await post('/enroll/complete', {
      lookupId: parsed.lookupId,
      sealed: b64(seal(isk, sid, 'request', enc.encode(JSON.stringify(plain)))),
    });
    expect(complete.statusCode).toBe(404);
    expect(await t.db.select().from(nodes).where(eq(nodes.orgId, org))).toHaveLength(0);
  });

  it('refuses a second device with the same key', async () => {
    const { org, pool } = await setup('e-dup');
    const kp = generateKeyPairSync('ed25519');
    const a = (await create(org, pool)).json<{ code: string }>().code;
    expect((await enrol(a, { keyPair: kp })).complete?.statusCode).toBe(200);
    const b = (await create(org, pool)).json<{ code: string }>().code;
    expect((await enrol(b, { keyPair: kp })).complete?.statusCode).toBe(409);
  });

  it('is admin-only and tenant-scoped, and codes can be cancelled', async () => {
    const { org, pool } = await setup('e-acl');
    await call('POST', `/organisations/${org}/members`, 'own@k.io', {
      email: 'mem@k.io',
      role: 'member',
    });
    expect((await create(org, pool, 'mem@k.io')).statusCode).toBe(403);
    expect((await create(org, pool, 'out@k.io')).statusCode).toBe(404);

    const made = (await create(org, pool)).json<{ enrollment: { id: string }; code: string }>();
    const list = await call('GET', `/organisations/${org}/pools/${pool}/enrollments`, 'own@k.io');
    expect(list.json<{ id: string }[]>()).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain(made.code.slice(5));
    const del = await call(
      'DELETE',
      `/organisations/${org}/enrollments/${made.enrollment.id}`,
      'own@k.io',
    );
    expect(del.statusCode).toBe(204);
    expect((await enrol(made.code)).start.statusCode).toBe(404);
  });
});
