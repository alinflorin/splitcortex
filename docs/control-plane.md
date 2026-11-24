# Control plane (`src/control-plane`)

Rules: [CLAUDE.md](../CLAUDE.md).

## Conventions

- Fastify 5 + `fastify-type-provider-zod` (zod 4), Postgres via **Drizzle**. Schema `src/db/schema.ts`; plain SQL migrations (`drizzle-kit generate` into `drizzle/`, committed; the gateway reads the same tables with its own SQL); never edit applied ones, additive only.
- DTOs are zod schemas in `src/dto` (**no shared package**; UI copies by hand). Every route validates params/body/response and is in OpenAPI; **Swagger at `/api/docs`** (Authorize via Dex code + PKCE, public client `splitcortex-ui`, whose Dex `redirectURIs` must include `<web app origin>/api/docs/static/oauth2-redirect.html` in every environment).
- **Errors are translated** (`src/i18n/messages.ts`, en + ro): routes throw `app.httpErrors.x('errors.key')` (`withParams` for placeholders); `plugins/i18n.ts` translates by `Accept-Language` (English fallback, `Content-Language` set). Add keys to both catalogues (a test checks parity). Validation messages are i18n keys.
- Routes under `/api` (not stripped by ingress; same origin on web app and web node hosts, no CORS). `/healthz`, `/readyz` (DB) at root.
- **Auth**: Dex JWT via `jose` against the JWKS (audience `splitcortex-ui`; JWKS URL defaults to in-cluster Dex). **No users table**: identity from claims (`GET /api/me`); memberships store the lowercased email. `requireOrgRole` (non-members get 404).
- Tests on in-process **PGlite** (`src/test/harness.ts`) with the real migrations.
- Config changes: `recordConfigChange` inside the transaction, `notifyConfigChange` after commit ([gateway.md](gateway.md)).

## Entities and API

- **Roles**: owner/admin/member. Owners manage everyone; admins manage only plain members and can't grant higher roles; anyone may leave; the **last owner can't be demoted or removed**. Org delete owner-only. Pool DTO `onlineNodes` = approved, connected, `node_status` <60 s old; `totalNodes` = approved. Deleting a pool/org records `node` changes so the gateway closes sockets.
- **Account deletion** (`DELETE /api/me`): removes memberships and pending codes, anonymises `created_by` on keys/benchmarks; **409 `errors.accountOwnsOrgs` while sole owner of any org**. Dex is never touched.
- **Nodes**: created **only by enrollment**. `PATCH .../nodes/:nodeId` (admin) sets overrides `computeBackend` cpu|gpu|null, `maxContextTokens` 512..131072|null, `keepScreenOn`, `enableMtp` (a `node` change; gateway pushes `NodeConfig`). `node_status` is **written by the gateway only**; online = `connected` AND row <60 s old. `GET /api/node/me` (device-auth, approved) returns name, org, pool, approval.
- **Remote restart**: `POST .../nodes/:nodeId/restart` (admin, `202 {id}`, `409 errors.nodeOffline` unless online, audited `node.restart`) inserts `node_commands` + `NOTIFY`.
- **API keys** (admin/owner): `PATCH .../:keyId` takes `expiresAt` (future or null) and limits (revoked = 409; extending an expired key revives it); `DELETE` = soft revoke, idempotent. Token `sc_` + 32 random bytes base64url, shown once; stored `sha256` hex + 10-char prefix. The gateway checks `revoked_at`/`expires_at` itself.
- **Limits**: nullable `limit_requests_per_minute`, `limit_tokens_per_minute`, `limit_tokens_per_day` on orgs and keys (`src/dto/limits.ts`; bounds 1..10^7 / 10^9 / 10^12). Org PATCH takes partial `limits` (null clears, `{}` rejected).
- **Usage**: `usage_records` written by the gateway only (no FKs on `pool_id`/`key_id`, so history outlives deletions). `GET .../usage`: `from`/`to` ≤92 days, `granularity` hour|day, `groupBy` pool|key|model.
- **Metrics**: `GET .../metrics` (any member): `from`/`to` (default 1 h, max 7 days), `step` `1m|5m|15m|1h` (default ~240 points), optional `poolId`/`nodeId`. Pools: usage, refusals, peak in-flight, p50/p95 latency and TTFT (histogram bucket upper bound). Nodes: per-step averages, lowest battery, highest temperature, gateway-measured `measuredTokensPerSec` vs reported `tokensPerSec`. Retention CronJob `control-plane-metrics-prune` (`controlPlane.metricsPrune.*`, 7 days, hourly).
- **Audit log**: `audit_logs` (org FK cascade, `source` control_plane|gateway, actor, dotted `action`, entity, `outcome` success|denied|failed, ip, jsonb `metadata`). `plugins/audit.ts` (`onSend`) records every mutation under `/organisations` from the `RULES` table (success on 2xx, `denied` on 403; non-members get 404 and are **not** logged); an unlisted mutating route (`RULES` or `NOT_AUDITED` with a reason) fails startup. Written after the response; a failed write never causes a 500. PATCH bodies in `metadata.changes`. `node.enroll` written in the enrollment transaction. `GET .../audit-logs` (admin/owner): filters `action` (exact or prefix ending `.`), `actor`, `outcome`, `source`, `from`/`to`; newest first, keyset cursor, `limit` ≤100. `.../audit-logs/export`: `csv|json`, streamed in batches of 1000, CSV cells starting `= + - @` prefixed with `'`; reading isn't audited. CronJob `control-plane-audit-prune` (90 days, daily). Org delete removes its rows (so isn't audited).
- **Benchmarks**: `GET/POST .../pools/:poolId/benchmarks`, `DELETE .../:benchmarkId` (admins write, members read). Pool must serve a **chat** model (embedding = 409), ≥1 node online, none started in the last 5 min; newest 10 kept. Results come from the gateways.
- **Models**: `models.kind` `chat` (default) or `embedding`, set on `from-url`/`uploads`. **One model per pool**: `pool_models.pool_id` unique; `PUT .../pools/:poolId/models/:modelId` replaces it.

## Models and object storage

- Org-scoped (`models`, `pool_models`; unique name per org; only `.litertlm`, ≤32 GiB). Files on **Garage** (single node, subchart `garage` 2.5.0 from `https://charts.derwitt.dev`, replication 1, credentials in Secret `garage-credentials`). **Internal only: no ingress, no public S3, no CORS.** Without S3 config model endpoints answer 503.
- **Job `garage-bootstrap`** (control plane image, `storage/bootstrap-cli.ts`; plain Job on first install, `post-upgrade` hook after; under Tilt the control plane depends on it) sets layout, key, bucket via the Garage admin API; idempotent; only it holds the admin token.
- **Uploads stream through the control plane, never buffered**: `POST /models/uploads` → `{model, partSize, partCount}` (8 MiB parts, larger for huge files to stay under 10 000); the browser `PUT`s each part to `/models/:id/parts/:n` (piped to S3 `UploadPart`); `POST /models/:id/complete` verifies size. Small parts because of Traefik's 60 s read timeout.
- **Hugging Face URLs** are mirrored once by an in-process worker (`models/mirror.ts`; claimed `FOR UPDATE SKIP LOCKED`, stale claims recovered after 2 min, progress heartbeat doubles as cancellation): `https` on `huggingface.co`/`*.hf.co` only, redirects followed manually and re-checked per hop (SSRF), optional `HF_TOKEN` to `huggingface.co` only, sha256 while streaming. Uses `models/https-fetch.ts` (`node:https`), **not built-in `fetch`**: undici is ~20x slower on multi-GiB files. Nodes never talk to Hugging Face.
- **Node downloads**: `GET /api/node/models` lists the pool's ready models (`id, name, kind, fileName, sizeBytes, sha256`); `GET /api/node/models/:modelId/file` streams it (`Accept-Ranges`, one `Range` per request, `206`/`416`, `X-Content-SHA256`/`ETag`). Not ready or not in the node's pool = generic 404.
- **Device auth** (`plugins/node-auth.ts`): `Authorization: Node <nodeId>.<unixSeconds>.<signature>`, Ed25519 over `splitcortex-node-request-v1\nMETHOD\npath\nunixSeconds` (path as received, no query, with `/api`); skew ≤60 s; unapproved/deleted fail; every failure the same 401.
- **Sweep**: CronJob `control-plane-sweep` (`controlPlane.sweep`, `maxAgeHours` 24; `storage/sweep.ts`) deletes models stuck `uploading` and aborts orphan multipart uploads.

## Migrations

`controlPlane.migrate` runs `dist/db/migrate.js`: plain Job on first install (a post-install hook would deadlock), `pre-upgrade` hook Job on upgrades. Tilt: plain Job `control-plane-migrate` that `control-plane` depends on; new migration files aren't live-synced, so Tilt rebuilds the image and recreates the Job.
