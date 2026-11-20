# Enrollment and node identity

Hard rules in [CLAUDE.md](../CLAUDE.md).

## Identity

- **Node**: each node generates its own key pair; the private key never leaves the device (secure keystore where possible). Enrollment registers the public key; the gateway authenticates by proof of possession (mutual challenge-response on connect, see [gateway.md](gateway.md)). Identity comes from the registered key, never from stream messages. Revoking = deleting the registered public key.
- **Server**: the gateway has its own key pair; nodes pin its public key at enrollment and verify the gateway independently of the TLS CA chain.

## Flow (admin starts it in the web app, the device completes it)

- An admin picks a pool and creates an enrollment (org, pool, expiry ~10 min, single use, attempt-limited), shown as a **short code `XXXX-XXXXXX`** (Crockford base32) and as a QR (convenience only: enrollment URL + the same code). **Every device must be able to enroll by typing the code.**
- First 4 chars = lookup id, unique among active enrollments across orgs (unique index, not reused until expired); last 6 = the secret. The code reveals nothing about org/pool before success.
- The device takes the code and an **enrollment URL (control plane/BFF; has a default, user-editable** for self-hosted/LAN). It never talks to the gateway while enrolling; the PAKE rounds are plain HTTPS request/response with state in the database so any instance can serve any round.
- Device keys are **never derived from the code**; the code only authorizes registering the device's public key.
- A **PAKE (CPace)** keyed by the secret authenticates both sides and resists offline attacks; inside the protected channel the control plane sends the gateway's public key and wss URL (device pins the key) and the device sends its public key and info. A fake server at an edited URL learns nothing. This is what lets a short code replace a long pinned-key QR.
- Online guessing is bounded: 3 attempts per enrollment, then invalidated, plus per-IP limits. The secret is single-use, consumed in the transaction that registers the device. Optional per-pool **admin approval**: the device shows as pending with a short fingerprint of its public key for the admin to compare. After enrollment the code is dead.

## Implementation (built)

- **Control plane**: table `enrollments` (lookup id unique, secret, `expires_at` 10 min, `attempts`/`max_attempts` 3, PAKE session `session_sid`/`session_isk`), `routes/enrollment.ts`, `enrollment/crypto.ts`. Admin routes (admin/owner): `POST/GET /organisations/:orgId/pools/:poolId/enrollments` (code returned **only** by create), `DELETE /organisations/:orgId/enrollments/:id`. Device routes (unauthenticated, per-IP limited, every failure the same `404`): `POST /api/enroll/start`, `POST /api/enroll/complete`. Expired rows purged on create. The IP limiter uses `req.ip`: `trustProxy` is the hop count `TRUSTED_PROXY_HOPS` (default 1 = Traefik, never `true`), and stg/prd set Traefik's Service to `externalTrafficPolicy: Local` (k3s klipper otherwise hides the client IP behind a node address).
- **Protocol**: CPace ristretto255/SHA-512 (`@cipherman/pake-js`; PRS = `splitcortex-enroll-v1:<6-char secret>`, CI = `splitcortex-enroll-v1`, device = initiator, picks the 16-byte `sid`). Round 1 (`start`: lookup id, sid, share) atomically consumes one of 3 attempts and stores the ISK; round 2 (`complete`, one per start) carries the device request **sealed** (ChaCha20-Poly1305, key = HKDF-SHA256(ISK, salt = sid, info `splitcortex-enroll-v1 request|response`), wire `nonce(12)||ct||tag`): Ed25519 public key (raw 32 bytes, base64url), a **proof-of-possession signature** over `"splitcortex-enroll-v1" || sid`, device info. The sealed response returns node id, fingerprint, approval state, `orgName`/`poolName` and the gateway `{publicKey, url}` (`GATEWAY_PUBLIC_KEY`/`GATEWAY_WSS_URL`, chart `controlPlane.gateway.*`; `null` until a gateway exists). The device accepts the server only if the response opens (mutual auth) and computes the fingerprint itself. A wrong secret decrypts to nothing and looks like any invalid code; exhausted rows are deleted.
- **Fingerprint**: SHA-256 of the raw public key, first 60 bits as Crockford base32 `XXXX-XXXX-XXXX`; shared test vectors asserted on both sides.
- **Deliberate deviation**: CPace is balanced, so the server stores the 6-char secret itself (not a hash) for the code's ≤10 min life and deletes the row on success, expiry or exhaustion. An augmented PAKE wouldn't help (30 bits fall to offline guessing either way). Accepted limit: anyone who can reach the endpoint can burn a code's 3 attempts by guessing its 4-char lookup id (per-IP limit slows it; the admin makes a new code).
- **Pool approval**: `pools.require_approval` makes the node `approved = false` until an admin approves; else active at once. An already-registered device key gets `409`. A `node` config change is recorded so the gateway learns the node.
- **Phone** (`src/mobile-node/src/enrollment/`: `crypto.ts` is the byte-compatible device half, `client.ts`, `identity.ts`, `store.ts`): key generated on first use with `@noble/curves`, kept in `expo-secure-store` (Keystore-backed encryption), **not hardware-resident non-exportable** (Ed25519 isn't available via Expo keystore APIs). `src/polyfills.ts` supplies `crypto.getRandomValues` from `expo-crypto`. The noble/pake packages are ESM-only, so Jest's `transformIgnorePatterns` lists `@noble|@cipherman`. Run on real Android devices by the owner. The web, desktop and CLI nodes port the same device half.
- **Library**: `@cipherman/pake-js` (pure JS on `@noble/curves`, no WASM so it runs on Hermes; passes draft-20 vectors per its README; single maintainer, pre-1.0, **not independently audited**). `cpace-ts` rejected (needs WebAssembly). Fallback if unusable: TLS with CA validation plus mandatory admin approval (weaker first-contact trust).

## Bulk codes (built)

`POST /organisations/:orgId/pools/:poolId/enrollments/bulk` `{count}` (1..50, admin or owner) creates that many ordinary codes at once: each single use, 3 attempts, **10 minutes** (the rule is unchanged on purpose), distinct lookup ids, all or nothing (a failure deletes the codes it already made). Audited as `enrollment.create_bulk` (`count` in the metadata). The web app's _Add many devices_ dialog lists the codes, shows how many were used (it polls the pool's active codes: a used code disappears), copies all, downloads a CSV, and cancels the unused ones on close.

## Open

Whether the key pair also signs messages and model manifests.
