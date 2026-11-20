# Enrollment and node identity

Hard rules in [CLAUDE.md](../CLAUDE.md).

## Identity

- **Node**: its own key pair, private key never leaves the device. Enrollment registers the public key; the gateway authenticates by proof of possession ([gateway.md](gateway.md)). Identity comes from the registered key, never from stream messages. Revoking = deleting the key.
- **Server**: the gateway's key pair; nodes pin its public key at enrollment and verify the gateway independently of the TLS CA chain.

## Flow (admin starts it in the web app, the device completes it)

- An admin picks a pool and creates an enrollment (10 min, single use, 3 attempts), shown as a **code `XXXX-XXXXXX`** (Crockford base32) and a QR (enrollment URL + the same code). **Every device must be able to enroll by typing the code.**
- First 4 chars = lookup id (unique among active enrollments across orgs); last 6 = the secret. The code reveals nothing about org/pool before success.
- The device takes the code and an **enrollment URL** (control plane; has a default, editable for self-hosted/LAN). It never talks to the gateway while enrolling; the PAKE rounds are plain HTTPS with state in the database, so any instance can serve any round.
- Device keys are **never derived from the code**; the code only authorizes registering the device's public key.
- A **PAKE (CPace)** keyed by the secret authenticates both sides and resists offline attacks; inside the channel the control plane sends the gateway's public key and wss URL (the device pins the key) and the device sends its public key and info. A fake server at an edited URL learns nothing.
- Online guessing: 3 attempts, then invalidated, plus per-IP limits. Optional per-pool **admin approval**: the device shows as pending with a short key fingerprint for the admin to compare.

## Implementation (built)

- **Control plane**: table `enrollments` (lookup id, secret, `expires_at`, `attempts`/`max_attempts`, PAKE session `session_sid`/`session_isk`), `routes/enrollment.ts`, `enrollment/crypto.ts`. Admin routes (admin/owner): `POST/GET /organisations/:orgId/pools/:poolId/enrollments` (code returned **only** by create), `DELETE /organisations/:orgId/enrollments/:id`. Device routes (unauthenticated, per-IP limited, every failure the same `404`): `POST /api/enroll/start`, `/complete`. Expired rows purged on create. The IP limiter uses `req.ip`: `trustProxy` = `TRUSTED_PROXY_HOPS` (default 1 = Traefik, never `true`); stg/prd set Traefik's Service to `externalTrafficPolicy: Local` so k3s doesn't hide the client IP.
- **Protocol**: CPace ristretto255/SHA-512 (`@cipherman/pake-js`; PRS = `splitcortex-enroll-v1:<secret>`, CI = `splitcortex-enroll-v1`, device is initiator and picks the 16-byte `sid`). Round 1 (`start`) atomically consumes an attempt and stores the ISK; round 2 (`complete`) carries the request **sealed** (ChaCha20-Poly1305, key = HKDF-SHA256(ISK, salt = sid, info `splitcortex-enroll-v1 request|response`), wire `nonce(12)||ct||tag`): Ed25519 public key (raw 32 bytes, base64url), a **proof-of-possession** signature over `"splitcortex-enroll-v1" || sid`, device info. The sealed response returns node id, fingerprint, approval state, `orgName`/`poolName` and the gateway `{publicKey, url}` (`controlPlane.gateway.*`; `null` until a gateway exists). The device accepts the server only if the response opens and computes the fingerprint itself. A wrong secret looks like any invalid code; exhausted rows are deleted.
- **Fingerprint**: SHA-256 of the raw public key, first 60 bits as Crockford base32 `XXXX-XXXX-XXXX`; shared test vectors on both sides.
- **Deliberate deviation**: CPace is balanced, so the server stores the 6-char secret itself for the code's ≤10 min life (deleted on success, expiry or exhaustion); an augmented PAKE wouldn't help against offline guessing of 30 bits. Accepted: anyone reaching the endpoint can burn a code's attempts by guessing its lookup id (the per-IP limit slows it; make a new code).
- **Pool approval**: `pools.require_approval` leaves the node `approved = false` until an admin approves. An already-registered device key gets `409`. A `node` config change is recorded so the gateway learns the node.
- **Device halves**: mobile (`src/mobile-node/src/enrollment/`: `crypto.ts`, `client.ts`, `identity.ts`, `store.ts`; key via `@noble/curves` in `expo-secure-store`, not hardware-resident; `src/polyfills.ts` supplies `crypto.getRandomValues`; Jest `transformIgnorePatterns` lists `@noble|@cipherman`), web and CLI ports of the same code.
- **Library**: `@cipherman/pake-js` (pure JS on `@noble/curves`, no WASM so it runs on Hermes; draft-20 vectors; single maintainer, pre-1.0, **not audited**). `cpace-ts` rejected (needs WebAssembly). Fallback: TLS with CA validation plus mandatory approval.

## Bulk codes (built)

`POST .../pools/:poolId/enrollments/bulk` `{count}` (1..50, admin/owner): ordinary codes (single use, 3 attempts, 10 minutes), all or nothing, audited as `enrollment.create_bulk`. The _Add many devices_ dialog lists them, tracks used ones (a used code disappears from the active list), copies all, downloads CSV, cancels unused on close.

## Open

Whether the key pair also signs messages and model manifests.
