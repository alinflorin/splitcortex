# SplitCortex

SplitCortex is a SaaS platform that turns idle mobile compute (phones, Raspberry Pis, other small devices) into inference serving nodes. Users bring their devices, group them into pools, and serve models through a single managed API.

> Status: early design. No implementation yet; this document describes the intended scope.

## What it does

- **Accounts and organisations**: users register, create organisations, and manage memberships and roles.
- **Inference pools**: an organisation groups its devices into pools. Each pool serves a set of models.
- **API keys**: per-organisation key management for clients calling the inference API.
- **API gateway**: the platform is the single public entry point. It authenticates requests, load-balances them across the nodes in a pool, and manages model distribution.
- **Device nodes**: endpoint devices keep a persistent WebSocket connection (protobuf messages) to the gateway over TLS, with no message broker. The gateway pushes work down this connection, so devices do not need to be publicly reachable.
- **Usage tracking and limits**: token usage is metered per key, pool and organisation, with configurable limits.
- **Dashboards and config pages**: usage, node health, pool state, and settings in the web UI.

## Architecture (high level)

```
 clients ──HTTPS──▶  gateway, Rust (auth, limits, metering, load balancing, model mgmt)
                          │
                          │  persistent WebSocket (protobuf) over TLS
                          ▼
                    device nodes (phone / RPi / ...)
                          └─ inference engine: LiteRT-LM
```

- Nodes connect outbound to the gateway, so NAT and mobile networks are not a problem.
- **Routing**: each API key is bound to one pool. The gateway authenticates the key, checks limits, then picks a healthy node in that pool that has the requested model, favouring less-loaded and faster devices. If a node fails before producing output the request is retried once on another node.
- **Node and server identity**: each node generates its own key pair and registers its public key when it enrolls. Enrollment is started in the web app, which shows a short one-time code (and a QR); the device user types or scans it in the mobile app, optionally pointing it at a different enrollment URL. Enrollment happens between the device and the control plane over HTTPS; the control plane hands the device the gateway address and public key, and the device then connects to the gateway. The server has its own key pair, which nodes trust from enrollment onwards. The two sides authenticate each other with these keys.
- **Models are currently replicated**: every device in a pool holds a full copy of the pool's models.
- **Engine**: LiteRT-LM is the only supported inference engine for now.

## Roadmap / open research

- **Sharding large models across multiple devices.** Models that do not fit on a single device cannot be served today. We need to investigate how to split a model over several devices (pipeline/tensor parallelism over weak, high-latency links) and what the engine supports.
- Additional inference engines beyond LiteRT-LM.

## Tech stack

- **Frontend** (`src/ui`): Vite, React (with React Compiler), TypeScript, Fluent UI with light/dark Teams themes, react-hook-form, zod, React Router, react-i18next (English and Romanian), self-hosted Inter font (no CDNs), signing in through Dex (OIDC).
- **Endpoint app**: React Native with Expo and TypeScript, run on physical devices via local dev builds (no EAS). A native module wraps LiteRT-LM, so Expo Go is not supported.
- **Control plane** (`src/control-plane`): TypeScript with Fastify, zod-validated routes with a generated OpenAPI spec and Swagger UI (`/api/docs`), PostgreSQL through Drizzle ORM with SQL migrations. DTOs are zod schemas in the project; the frontend copies what it needs.
- **Gateway**: Rust, for performance on the hot path (OpenAI-format HTTP/SSE edge, node WebSocket connections, auth, limits, metering, load balancing). Always-on service, no serverless. It shares the node protobuf schema and the data store with the control plane, not the zod schemas.
- The gateway caches configuration in memory and follows a database change log written by the control plane (no Redis). If the database is unreachable the gateway keeps serving the last known config, and may reject new requests with `503` once that config is older than a configurable maximum age. The database is PostgreSQL; web-app sign-in uses Dex.
- The gateway counts usage itself and flushes it to the database in batches. If a flush fails, counters stay in memory and are retried with backoff in an idempotent, de-duplicated batch (no lost or double-counted usage), and they are flushed on shutdown. If the database stays unreachable until the buffer is full or its oldest data passes a configurable age (default about 10 minutes), the gateway fails closed with `503` rather than serve unmetered traffic; self-hosted deployments can opt to drop the oldest data instead.

## Repository layout

- `chart/`: Helm chart skeleton (`Chart.yaml`, helpers, empty `values.yaml` for local dev and `values-stg.yaml` / `values-prd.yaml` overrides, and a git-ignored `values-local.yaml` for personal overrides). It bundles the Traefik ingress controller (`traefik.enabled`) cert-manager (`cert-manager.enabled`) PostgreSQL (`postgres.enabled`, with randomly generated credentials kept in a Secret) and the Dex identity provider (`dex.enabled`, served at `dex.splitcortex.127.0.0.1.nip.io` locally and `dex.stg.splitcortex.com` / `dex.prd.splitcortex.com` in staging and production, password DB enabled, 15 minute access tokens, 3 month refresh tokens, initial local user in `values-local.yaml`) as optional dependencies. It defines a self-signed `root-ca-issuer` ClusterIssuer everywhere and a Let's Encrypt (production) `letsencrypt` ClusterIssuer in staging and production. It also defines Traefik rate-limit middlewares: a general per-IP limit for the web app, control plane and Dex, and a much higher per-API-key ceiling for the gateway so heavy inference traffic is not throttled. Traefik redirects all HTTP traffic to HTTPS. Traefik and cert-manager can each be turned off to use an external ingress controller or cert-manager (see CLAUDE.md for the values). For local k3s development an optional CoreDNS override makes the `nip.io` hostnames resolve to Traefik from inside pods too (`dev.coredns.enabled`, off in staging and production). Workload templates are added as the services land (UI and control plane so far).

- `.github/workflows/`: CI/CD. The chart is linted and validated on every change and published as an OCI artifact to GHCR when a `vX.Y.Z` tag is pushed. Service images (the UI and the control plane) are built from a reusable workflow template as multi-arch images (amd64 and arm64 built in parallel on native runners, then merged into one manifest) with the GitHub Actions cache: PRs build only, pushes to `main` and manual runs push `<branch>`/`sha-*` tags to GHCR, and a `vX.Y.Z` tag runs the release workflow: it publishes the chart and all images as `X.Y.Z` in parallel, then deploys that version to stg automatically. Deployments are also a separate workflow you can run manually (stg or prd, any version).

- `src/ui/`: the web app (responsive layout: sidebar always visible on large screens, hideable on mobile, top bar with a single avatar menu holding the theme (System by default, Light, Dark) and language (detected from the browser, English fallback) choices, profile and sign in/out; Home and About are public, Settings requires sign-in). Run with `pnpm dev` inside that folder, or via Tilt: it is built into a Caddy-based image (`src/ui/Dockerfile`) and deployed by the chart (`ui.*` values, ingress enabled by default).

- `src/control-plane/`: the control plane API (organisations, memberships, pools so far; served at `/api` on the web app host, Swagger UI at `/api/docs`) with its zod DTOs. Database migrations are generated with `pnpm db:generate` and applied by a Helm hook Job on install and upgrade (and by a Job before the API starts under Tilt).

Other directories will be added as the codebase takes shape.

## Domains

| Service | local | stg | prd |
| --- | --- | --- | --- |
| Dex (IdP) | `dex.splitcortex.127.0.0.1.nip.io` | `dex.stg.splitcortex.com` | `dex.prd.splitcortex.com` |
| Web app | `app.splitcortex.127.0.0.1.nip.io` (planned) | `app.stg.splitcortex.com` (assumed) | `app.prd.splitcortex.com` (assumed) |

## Getting started

Not yet available.

## License

TBD.
