import { cpace } from '@cipherman/pake-js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { EnrollError, enroll } from './client';
import { fromB64, open, seal, toB64 } from './crypto';

const enc = new TextEncoder();
const SECRET = 'QX9H4T';

const privateKey = ed25519.utils.randomSecretKey();
const identity = {
  privateKey,
  publicKey: ed25519.getPublicKey(privateKey),
  publicKeyB64: toB64(ed25519.getPublicKey(privateKey)),
};

/** A fake control plane doing the server half of the protocol with the given secret. */
function fakeServer(opts: { secret?: string; status?: number } = {}) {
  let isk: Uint8Array;
  let sid: Uint8Array;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    if (opts.status) return new Response('{}', { status: opts.status });
    const body = JSON.parse(init.body as string);
    if (url.endsWith('/enroll/start')) {
      sid = fromB64(body.sid);
      const me = cpace.ristretto255.init({
        PRS: enc.encode(`splitcortex-enroll-v1:${opts.secret ?? SECRET}`),
        sid,
        CI: enc.encode('splitcortex-enroll-v1'),
      });
      isk = cpace.ristretto255.deriveIskInitiatorResponder({
        ephemeralSecret: me.ephemeralSecret,
        ownShare: me.share,
        peerShare: fromB64(body.share),
        ownAD: enc.encode('server'),
        peerAD: enc.encode('device'),
        sid,
        role: 'responder',
      });
      return Response.json({ share: toB64(me.share) });
    }
    const plain = open(isk, sid, 'request', fromB64(body.sealed));
    if (!plain) return new Response('{}', { status: 404 });
    requests.push(JSON.parse(new TextDecoder().decode(plain)));
    const reply = { nodeId: 'n-1', fingerprint: 'x', approved: false, gateway: null };
    return Response.json({
      sealed: toB64(
        seal(isk, sid, 'response', enc.encode(JSON.stringify(reply)), new Uint8Array(12)),
      ),
    });
  }) as unknown as typeof fetch;
  return requests;
}

const run = (code = `K7M2-${SECRET}`) =>
  enroll({ baseUrl: 'https://cp.example/api/', code, identity, device: { deviceModel: 'Pixel' } });
const kind = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: EnrollError) => e.kind,
  );

describe('enroll', () => {
  it('registers the key and returns the result', async () => {
    const requests = fakeServer();
    const r = await run();
    expect(r).toMatchObject({ nodeId: 'n-1', approved: false, gateway: null });
    expect(requests[0]).toMatchObject({ publicKey: identity.publicKeyB64, deviceModel: 'Pixel' });
    // Proof of possession: signature over the label and the session id.
    expect(requests[0]!.signature).toEqual(expect.any(String));
  });

  it('answers invalid code when the server rejects our secret', async () => {
    fakeServer({ secret: 'ZZZZZZ' });
    expect(await kind(run())).toBe('invalidCode');
  });

  it('refuses a server that cannot prove it knows the code', async () => {
    fakeServer();
    const real = globalThis.fetch;
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      const res = await real(url, init);
      if (!url.endsWith('/enroll/complete')) return res;
      // 200 with a message sealed under some other key
      return Response.json({ sealed: toB64(new Uint8Array(64).fill(3)) });
    }) as unknown as typeof fetch;
    expect(await kind(run())).toBe('untrustedServer');
  });

  it('maps HTTP failures', async () => {
    fakeServer({ status: 404 });
    expect(await kind(run())).toBe('invalidCode');
    fakeServer({ status: 429 });
    expect(await kind(run())).toBe('rateLimited');
    fakeServer({ status: 409 });
    expect(await kind(run())).toBe('conflict');
    fakeServer({ status: 500 });
    expect(await kind(run())).toBe('server');
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await kind(run())).toBe('network');
  });

  it('rejects a malformed code without calling the server', async () => {
    fakeServer();
    expect(await kind(run('nope'))).toBe('invalidCode');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
