import { createHash, randomBytes } from 'node:crypto';
import { appUrl, credentials, dexUrl } from './env.ts';

// Signs in to Dex without a browser: authorization code flow + PKCE as the public `splitcortex-ui` client, through
// Dex's own password form. Returns the access token the control plane accepts as a bearer token. A local stack's CA
// must be trusted by Node (NODE_EXTRA_CA_CERTS=<root CA pem>).
const CLIENT_ID = 'splitcortex-ui';
const b64url = (b: Buffer) => b.toString('base64url');
// Dex's HTML escapes `&` and also `+` (`&#43;`, which would cut the scope list short): decode the entities it uses.
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

export async function getAccessToken(): Promise<string> {
  const { user, password } = credentials();
  const redirectUri = `${appUrl}/`;
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());

  let url = `${dexUrl}/auth?${new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email offline_access',
    state: b64url(randomBytes(8)),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })}`;
  let init: RequestInit | undefined;
  let posted = false;
  let code: string | null = null;

  for (let step = 0; step < 15 && !code; step++) {
    const res = await fetch(url, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') ?? '', url).toString();
      if (next.startsWith(redirectUri)) code = new URL(next).searchParams.get('code');
      else url = next;
      init = undefined;
      continue;
    }
    const html = await res.text();
    const form = html.match(/<form[^>]*action="([^"]*)"/);
    if (/name="login"/.test(html) && form) {
      if (posted) throw new Error('Dex rejected the E2E_EMAIL / E2E_PASSWORD login');
      posted = true;
      url = new URL(decode(form[1]!), url).toString();
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ login: user, password }),
      };
      continue;
    }
    // Connector chooser (stg also has Google): take the local password database.
    const local = html.match(/href="([^"]*\/auth\/local[^"]*)"/);
    if (!local)
      throw new Error(`Unexpected Dex page (HTTP ${res.status}) at ${new URL(url).pathname}`);
    url = new URL(decode(local[1]!), url).toString();
    init = undefined;
  }
  if (!code) throw new Error('Dex did not return an authorization code');

  const res = await fetch(`${dexUrl}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Dex token endpoint answered ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
