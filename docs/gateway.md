# Gateway (`src/gateway`, Rust)

Rules: [CLAUDE.md](../CLAUDE.md). tokio + axum 0.8, sqlx, prost, ed25519-dalek. `cargo test`; `cargo run -- keygen` prints a key pair.
Env: `DATABASE_URL`, `GATEWAY_PRIVATE_KEY` (base64url Ed25519 seed), `PORT`, `LOG_LEVEL`, `USAGE_MAX_BUCKETS`, `USAGE_MAX_AGE_SECONDS`, `GATEWAY_MAX_MEDIA_MB` (256), `DRAIN_*`.

Proto: `proto/splitcortex/node/v1/node.proto` (`protox` + `prost-build`, no `protoc`). Each binary WS frame is one `Envelope`; changes additive only.

## Node leg

- **Handshake on `GET /node`** (mutual proof): `ClientHello{node_id,nonce}` → `ServerHello{nonce,signature}` (gateway key over `splitcortex-gateway-hello-v1 \n node_nonce \n node_id`; node verifies against the pinned key first) → `ClientAuth{signature}` (over `splitcortex-node-hello-v1 \n server_nonce \n node_nonce \n node_id`) → `Ready`. ServerHello goes out for any id, so unknown ids look like a bad signature. Org/pool from the cached record, never the stream. Node must be `approved`; a newer connection replaces the older. `max_in_flight` = 1.
- **Models**: after `Ready` and on change, `ModelAssignment` (id, name, size, sha256, `kind`). One model per pool. Node downloads from the control plane (never the gateway) and reports `ModelState` (incl. `embedding_dimension`, `modalities`). Requests only reach nodes `READY` for the assigned model. Wrong kind → `wrong_model_kind`.
- **Engine settings per device**: admin overrides (`nodes.compute_backend`, `max_context_tokens`, `keep_screen_on`, `enable_mtp`; null = device decides) travel as `NodeConfig` after `Ready` and on change; node reports actuals into `node_status`.
- **Remote restart**: control plane inserts `node_commands` + `NOTIFY` (5 s poll backstop). The instance holding the node claims the row by deleting it, sends `Restart{grace_seconds=60}`, stops routing to it. Node finishes work, reconnects with resume. Unclaimed rows drop after 2 min. Flag lifts after grace + 30 s.
- **Reconcile**: every change batch and every 10 s, sockets of deleted/unapproved/moved nodes close and assignments are pushed.
- **Status**: `node_status` written on connect/disconnect/telemetry (10 s), refreshed every 15 s; at start an instance clears `connected` for its own `gateway_id`.
- **Resume**: `InferenceChunk/Done/Error` carry a per-request `seq`. On socket loss mid-stream the request is kept 20 s; one that produced nothing fails at once and is retried elsewhere. Node keeps generating (≤20 000 frames, until 60 s after end); after `Ready` it sends `Resume{request_ids}`; gateway answers `ResumeAck{request_id,received_seq}` or `Cancel`. No new request goes to a resuming node (until `Resume` or 5 s). Resume across instances is impossible. Node backoff 1–30 s with jitter, immediate on foreground.

## Client leg (OpenAI edge)

- Also served on the web app host (`gateway.appIngress`, `/v1` only) for the Playground: same origin, **no CORS**.
- `GET /v1/models` (union of the key's pools; adds `kind`, `context_length`, `input_modalities`, `max_media_bytes`), `POST /v1/chat/completions` (JSON or SSE; no `stream_options`, no tools), `POST /v1/embeddings`. Auth `Bearer sc_...`: SHA-256 in cache, DB fallback on miss + 10 s negative cache, `last_used_at` at most once a minute. OpenAI error shape, localized by `Accept-Language` (`i18n.rs`; `code`/`type` stable, node-supplied text relayed as is).
- Failure before first token: retry once on another node. Mid-stream: ends with an error event (no silent restart: avoids double metering). Client disconnect sends `Cancel`.
- **Embeddings**: `{model, input, dimensions?, encoding_format?: float|base64}` plus non-standard `task` (`query|document|classification|clustering|similarity`; node writes the prefix). Max 128 inputs, 32 000 chars each, no empties, no token arrays. `dimensions` truncates and renormalises on the node; node `bad_request` = `400`, not retried. Wrong model kind: `400 wrong_model_kind`. Benchmarks refuse embedding pools. Cross-instance via `/internal/v1/embeddings`.
- **Multimodal**: `content` is a string or parts: `text`, `image_url` (**base64 `data:` URL only**, JPEG/PNG/BMP/GIF), `input_audio` (`{data, format: wav|mp3|flac}`), only in `user` messages. Else a clear `400` (`unsupported_content_type|media_type|media_url`, `invalid_base64`). Limits: 64 parts, `GATEWAY_MAX_MEDIA_MB` decoded per request (`413 media_too_large`); body limit applies **after auth**. Wire: `ChatMessage.content` always has joined text, `parts` only with media. Media goes only to nodes with the modality (`registry.rs` `IMAGE`/`AUDIO` bits); ready nodes but none accepting = `400 unsupported_modality` (across instances via `node_status.modalities`), no ready node = `503`. A request is held ~3× in memory (body, decoded, protobuf): size pods accordingly. Token estimates: image 256, audio 6.25/s (WAV header, else 16 kB/s mp3, 64 kB/s flac). Media never logged.
- **Tokens**: one completion token per streamed piece; prompt tokens = chars/4 (no tokenizer yet); node-reported counts ignored.
- **Context-aware routing**: needs ≈ prompt chars/4 + `max_tokens` (1 if absent); smaller reported windows skipped (unknown fits); none large enough anywhere: `400 context_length_exceeded`.

## Routing and limits

- A key covers the whole org or chosen pools. Pool is **resolved from `model`** among the key's pools with it assigned and ready; none = `404`. No pool-selecting headers or paths.
- Registry keyed `(org, pool)`; eligible = connected, healthy, model ready. `pools.balancing_type`: `weighted_p2c` (default), `least_in_flight`, `round_robin`, `random`. `serving_type` is `replicated` only.
- **weighted_p2c**: of two random candidates keep the lower `(in-flight+1) / speed × (1 + 4 × failure rate)`. Speed = measured tokens/s (`NodePerf`: EWMA 0.3, completions ≥8 tokens and ≥250 ms), else reported telemetry; unknown = peer average. Failures (EWMA 0.2) count errors/drops, not client disconnects. Survives reconnects, forgotten after 1 h.
- No eligible node: `503` + `Retry-After`. Limits: `429` before touching any node.
- **Rate limits**: `requests_per_minute`, `tokens_per_minute`, `tokens_per_day` (UTC), null = unlimited, on org and key; both must allow, else `429 rate_limit_exceeded` + `Retry-After`. Minute windows are **per instance** (N instances ≈ N× limit); daily total re-read from `usage_records` every 10 s. A forwarded request is checked only by the receiving instance.

## Several instances

- Each instance heartbeats `gateway_instances` (pod name, `POD_IP:8081`; ignored >20 s, deleted 2 min). With no suitable local node it forwards to a peer holding nodes of the key's pools via `/internal/v1/...` on the **internal port** (not in Service/Ingress; bearer derived from the identity key, key hash in `X-Sc-Key`); the serving instance meters; peer `502/503` = next peer. A node seen on one instance is closed on the others within 15 s. Benchmarks run where the node is.
- **Graceful drain** on SIGTERM: set `draining`, fail `/readyz`, delete own row, keep serving `DRAIN_DELAY_SECONDS` (5), refuse new chats/nodes, close idle nodes, wait for running requests (≤`DRAIN_TIMEOUT_SECONDS`, default 3600; `terminationGracePeriodSeconds` = timeout + delay + 60), flush usage, exit. No benchmarks while draining.
- No shared store or broker; Redis/NATS only ever for presence/forwarding, never config or registry.

## Benchmarks

Control plane creates a `benchmarks` row plus a `pending` `benchmark_results` row per online node (admins, one at a time per pool). Every 4 s each gateway claims results of its nodes (`FOR UPDATE SKIP LOCKED`), waits up to 90 s for the node to be free, runs one fixed prompt (96 tokens, temperature 0), records time to first token, total time, pieces, tokens/s. Unrun results older than 3 min fail. Not metered.

## Identity key and rotation

- **Creation**: once, by Helm hook Job `gateway-identity-job.yaml` (`pre-install,pre-upgrade`, ServiceAccount limited to Secrets): init container runs `gateway keygen`, main creates Secrets **`gateway-identity`** (`private-key`, mounted only by the gateway) and **`gateway-public-key`** (read by the control plane, given to devices at enrollment). Both exist = nothing; only one = fail loudly. Not Helm-managed, survive `helm uninstall`; deleting them orphans every pinned device. Under Tilt a plain Job via `cargo run -- keygen`.
- **Rotation** (two-key overlap, one stage per `helm upgrade` via `gateway.rotation.stage`, Job `gateway-rotation`): `prepare` creates `-next` Secrets; gateways announce the next public key in `Ready.next_gateway_key` (signed by the current key over the connection nonce); devices trust both and report key ids (`node_status.gateway_keys`). `kubectl exec deploy/gateway -- gateway rotation-status` says when promoting is safe. `promote` keeps the old pair as `-previous`, makes next current, restarts gateways and control plane; then set the stage back to empty. A device offline for the whole overlap must re-enroll.

## Config cache, usage, metrics, audit

- **Cache (no Redis)**: nodes, pools, models, key hashes, limits in memory. The control plane writes a `config_changes` row (seq, entity, id, org) in the same transaction as each change, then `NOTIFY` (wake-up only). Startup: `LISTEN`, snapshot + `seq`, catch up. One consumer wakes on NOTIFY, reconnect or 30 s backstop, reads changes after its cursor with a 200-row overlap, de-duplicates, **re-fetches the row** (never diffs; missing = delete). Gap beyond retention = full resync. Sockets of deleted/revoked/re-keyed nodes close at once; revoked keys reject at once. DB down: keep serving last config.
- **Usage**: counters per (minute, org, pool, key, model) flushed every 5 s (backoff to 60 s) in one transaction with an additive upsert and a unique batch id in `usage_flushes` (retry of an ambiguous commit is a no-op). **Fail closed**: `503` + `Retry-After` when the buffer is full or the oldest bucket is older than ~10 min; self-recovers. Flush on SIGTERM.
- **Metrics** (`metrics.rs`): `pool_metrics` per minute/org/pool (`rate_limited`, `unavailable`, peak in-flight, latency and time-to-first-event histograms with `BOUNDS_MS`, shared with `dto/metrics.ts`); `node_metrics` per minute/node (last `Telemetry` plus additive `requests`, `failures`, `gen_tokens`, `gen_ms`; tokens/s = tokens/time, never an average of rates). Counted where the node is; 429/unavailable where the request arrived. Flushed every 20 s (backoff to 120 s), additive. **Not fail-closed** (full buffer drops the oldest minute and logs). Never per request; no instance ids. Retention 7 days (control plane CronJob).
- **Audit** (`audit.rs`): `node.connected`, `node.disconnected`, `node.connect_rejected` (known ids only), `api_key.rejected` (revoked/expired), `limit.exceeded`. Buffer 5000, flushed every 5 s to Postgres, **not fail-closed**; repeats of the same (org, action, entity) within 60 s fold into one row (`metadata.repeats`). No organisation (unknown key/node, drain) = not recorded. No IP yet.
