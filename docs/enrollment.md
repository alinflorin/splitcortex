# Enrollment and node identity

Hard rules in [CLAUDE.md](../CLAUDE.md).

## Identity

- **Node**: own key pair, private key never leaves the device. Enrollment registers the public key; the gateway authenticates by proof of possession ([gateway.md](gateway.md)). Revoking = deleting the key.
- **Server**: nodes pin the gateway's public key at enrollment and verify it independently of the TLS CA chain.

## Flow

- Admin creates an enrollment for a pool (10 min, single use, 3 attempts): **code `XXXX-XXXXXX`** (Crockford base32) plus QR (enrollment URL + code). **Every device must be able to enroll by typing the code.**
- First 4 chars = lookup id (unique among active enrollments across orgs), last 6 = secret. The code reveals nothing about org/pool before success.
- The device takes the code and an **enrollment URL** (control plane; default, editable for self-hosted/LAN). It never talks to the gateway; PAKE rounds are plain HTTPS with state in the DB, so any instance serves any round.
- Device keys are **never derived from the code**; the code only authorizes registering the public key.
- **CPace PAKE** keyed by the secret authenticates both sides and resists offline attacks; inside the channel the control plane sends the gateway's public key and wss URL and the device sends its public key and info. A fake server at an edited URL learns nothing.
- Online guessing: 3 attempts, then dead, plus per-IP limits. Optional per-pool **approval**: device shows pending with a short key fingerprint to compare.

## Implementation

- **Control plane**: table `enrollments`, `routes/enrollment.ts`, `enrollment/crypto.ts`. Admin: `POST/GET /organisations/:orgId/pools/:poolId/enrollments` (code returned **only** by create), `DELETE .../enrollments/:id`. Device (unauthenticated, per-IP limited, every failure the same `404`): `POST /api/enroll/start`, `/complete`. Expired rows purged on create. IP limiter uses `req.ip`: `trustProxy` = `TRUSTED_PROXY_HOPS` (default 1 = Traefik, never `true`); stg/prd set Traefik's Service to `externalTrafficPolicy: Local` so k3s keeps the client IP.
- **Protocol**: CPace ristretto255/SHA-512 (`@cipherman/pake-js`; PRS = `splitcortex-enroll-v1:<secret>`, CI = `splitcortex-enroll-v1`, device initiates with a 16-byte `sid`). `start` atomically consumes an attempt and stores the ISK; `complete` carries the request **sealed** (ChaCha20-Poly1305, key = HKDF-SHA256(ISK, salt = sid, info `splitcortex-enroll-v1 request|response`, wire `nonce(12)||ct||tag`): Ed25519 public key (raw 32 bytes, base64url), a **proof-of-possession** signature over `"splitcortex-enroll-v1" || sid`, device info. Sealed response: node id, fingerprint, approval state, org/pool names, gateway `{publicKey, url}` (`controlPlane.gateway.*`; `null` until a gateway exists). The device computes the fingerprint itself. A wrong secret looks like any invalid code; exhausted rows are deleted.
- **Fingerprint**: SHA-256 of the raw public key, first 60 bits as Crockford base32 `XXXX-XXXX-XXXX`; shared test vectors.
- **Deliberate deviation**: CPace is balanced, so the server stores the 6-char secret for the code's ≤10 min life (deleted on success/expiry/exhaustion); an augmented PAKE wouldn't help against offline guessing of 30 bits. Accepted: anyone can burn a code's attempts by guessing its lookup id (per-IP limit slows it; make a new code).
- **Approval**: `pools.require_approval` leaves the node `approved = false` until an admin approves. An already-registered key gets `409`. A `node` config change tells the gateway.
- **Device halves**: mobile (`src/mobile-node/src/enrollment/`; key via `@noble/curves` in `expo-secure-store`, not hardware-resident; `src/polyfills.ts` supplies `crypto.getRandomValues`; Jest `transformIgnorePatterns` lists `@noble|@cipherman`); web and CLI port the same code.
- **Library**: `@cipherman/pake-js` (pure JS on `@noble/curves`, no WASM so it runs on Hermes; single maintainer, pre-1.0, **not audited**). `cpace-ts` rejected (needs WebAssembly). Fallback: TLS with CA validation plus mandatory approval.

## Bulk codes

`POST .../pools/:poolId/enrollments/bulk` `{count}` (1..50, admin/owner): ordinary codes, all or nothing, audited `enrollment.create_bulk`.
