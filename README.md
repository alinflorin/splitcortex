# SplitCortex

SplitCortex is a SaaS platform that turns idle compute (phones, Raspberry Pis, laptops, even browser tabs) into inference serving nodes. Customers enroll their own devices into pools and serve a model through one managed, OpenAI-compatible API.

> Status: built end to end (control plane, gateway, web app and the phone, CLI and web nodes) and run by the owner on real laptops, browsers and Android devices. Measured speeds and per-OS results are not recorded yet.

## How it works

```
 clients ──HTTPS + SSE (OpenAI format)──▶ gateway ──WebSocket + protobuf (wss)──▶ device nodes
                                             │                                   (phone / Pi / laptop / browser)
                                             ▼                                   └─ engine: LiteRT-LM
                       control plane ◀──▶ Postgres        web app ──▶ control plane
```

- You create an **organisation**, add **pools** and enroll **devices** into them. A pool serves exactly one model, and every device in it holds a full copy.
- Devices connect **outbound** to the gateway, so NAT and mobile networks are not a problem. Enrollment is a short one-time code (or QR) created in the web app and typed or scanned on the device.
- Clients call the gateway with an **API key** (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`), only changing base URL and key. The gateway checks limits, picks a healthy node in the pool, and meters tokens.
- The web app shows usage, node health, models, API keys, limits, benchmarks, live metrics per organisation, pool and device (kept 7 days), and an audit log, and has a Playground to chat with a pool.

The business model is bring-your-own-devices SaaS: customers supply the compute, we run the control plane and gateway. No marketplace or payouts (reasoning in [Business model](#business-model)).

## Repository layout

| Folder              | What it is                                                                             | Docs                                           |
| ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `src/ui`            | Web app (Vite, React, Fluent UI)                                                       | [docs/ui.md](docs/ui.md)                       |
| `src/control-plane` | API: accounts, orgs, pools, keys, enrollment, models (Fastify, Postgres)               | [docs/control-plane.md](docs/control-plane.md) |
| `src/gateway`       | OpenAI edge plus node WebSocket (Rust); owns the node protobuf in `proto/`             | [docs/gateway.md](docs/gateway.md)             |
| `src/mobile-node`   | Android phone node (React Native, Expo)                                                | [docs/node-app.md](docs/node-app.md)           |
| `src/web-node`      | Browser node (static web app, WebGPU)                                                  | [docs/web-node.md](docs/web-node.md)           |
| `src/cli-node`      | Headless node (Rust, installed with one command)                                       | [docs/cli-node.md](docs/cli-node.md)           |
| `chart/`            | Helm chart for everything (Traefik, cert-manager, Dex, Postgres, Garage, our services) | [docs/layout.md](docs/layout.md)               |
| `scripts/`          | Dev helpers (Android emulator, wiki sync)                                              |                                                |

[CLAUDE.md](CLAUDE.md) holds the project rules and decisions; [docs/](docs/) holds the per-area detail. Read the doc of an area before changing it.

## Development setup

Everything runs on a local Kubernetes cluster driven by [Tilt](https://tilt.dev), so you get the same stack as staging (TLS, ingress, Dex login, Postgres, object storage). The `*.local.splitcortex.com` hostnames resolve to `127.0.0.1` in public DNS (one wildcard `A` record in Cloudflare), so no `/etc/hosts` edits are needed, and the certificates are real Let's Encrypt ones (DNS-01 through Cloudflare), so there is no CA to install in browsers or the Android emulator. Before `tilt up`, put `cloudflareApiToken` (Zone:DNS:Edit on `splitcortex.com`) in the git-ignored `chart/values-local.yaml`.

### Prerequisites

Required for the server side:

- **Docker** and a local registry at `localhost:5000`
- **k3s** (kubectl context named `default`), configured to use that registry: add it as a mirror in `/etc/rancher/k3s/registries.yaml`
- **Helm 3** and **Tilt**
- **Node.js 26** and **pnpm** (the version pinned in each `package.json`'s `packageManager`; `corepack enable` works)
- **Rust** (stable, via `rustup`) for the gateway and the CLI node

Only if you work on those parts:

- Mobile node: JDK, Android SDK, a real Android device or emulator (an emulator reaches the local stack with `adb reverse tcp:443 tcp:443`, since the local hostnames resolve to `127.0.0.1`); no Expo Go, local dev builds only

### Run the stack

```sh
tilt up            # at the repo root
```

Tilt installs the infrastructure chart first (Traefik, cert-manager, Postgres, Garage, Dex), then builds and live-reloads each service from a dev image. The first gateway build takes a few minutes.

| Service     | Local URL                                       |
| ----------- | ----------------------------------------------- |
| Web app     | https://app.local.splitcortex.com               |
| Web node    | https://web-node.local.splitcortex.com          |
| API docs    | https://app.local.splitcortex.com/api/docs      |
| Gateway     | https://gateway.local.splitcortex.com/v1/models |
| Dex (login) | https://dex.local.splitcortex.com               |

TLS uses real Let's Encrypt certificates, so there is nothing to trust or accept.

**Local login:** create `chart/values-local.yaml` (git-ignored) with your own Dex user. A bcrypt hash of the password goes in:

```yaml
dex:
  config:
    staticPasswords:
      - email: you@example.com
        hash: "<bcrypt hash, e.g. htpasswd -bnBC 10 '' 'password' | tr -d ':\n'>"
        username: you
        userID: 6f1d3a52-7a54-4c0e-9b4e-2f0a1c3b5d11
```

The same file is the place for any other personal chart override. All hostnames come from one value, `global.domain` (see [docs/layout.md](docs/layout.md)).

### Working on one project

Each of `src/ui`, `src/web-node`, `src/control-plane` and `src/mobile-node` is its own pnpm project:

```sh
pnpm install
pnpm dev          # standalone dev server (ui :5173, web-node :5174); or just use Tilt
pnpm typecheck
pnpm test
pnpm format       # run before committing
```

Open the standalone UI as `http://app.local.splitcortex.com:5173` so the Dex redirect matches.

Control plane database: `pnpm db:generate` after changing the schema (plain SQL migrations, never edit applied ones); migrations run automatically under Tilt. Tests use an in-memory Postgres (PGlite), so no database is needed.

Gateway and CLI node (Rust):

```sh
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

The CLI node also needs `python3 scripts/fetch-litert.py` once before `cargo build`.

Chart changes: `helm lint chart --strict` and `helm template splitcortex chart`.

### Things to know before you change code

- The node protobuf lives in `src/gateway/proto`; the phone and web nodes commit a generated copy (`pnpm gen:proto`).
- The control plane's zod DTOs are not shared with the gateway or the UI; the UI copies what it needs by hand.
- The CLI node is a separate Rust implementation of the web node's protocol, enrollment and runtime logic: a fix in one usually belongs in the other.
- API error messages exist in English and Romanian; add both.
- No CDNs (fonts and icons are self-hosted) and no CORS on the gateway or the node-facing hosts.
- Builds are slow: verify with typecheck, tests and `helm lint`/`helm template` rather than building images by hand.

## CI and releases

GitHub Actions lint, test and build every project. Releases are tag driven and each stream is independent:

| Tag                  | Releases                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| `vX.Y.Z`             | chart + web app + control plane + gateway; deploys to stg, prd is promoted by hand |
| `mobile-node-vX.Y.Z` | signed Android APK                                                                 |
| `cli-node-vX.Y.Z`    | CLI binaries                                                                       |

Tags are created from `VERSIONS.txt` by a workflow. See [docs/commands-and-ci.md](docs/commands-and-ci.md).

## Environments

| Service   | local                            | stg                            | prd                                      |
| --------- | -------------------------------- | ------------------------------ | ---------------------------------------- |
| Dex (IdP) | `dex.local.splitcortex.com`      | `dex.stg.splitcortex.com`      | `dex.prd.splitcortex.com`                |
| Web app   | `app.local.splitcortex.com`      | `app.stg.splitcortex.com`      | `app.prd.splitcortex.com` (assumed)      |
| Web node  | `web-node.local.splitcortex.com` | `web-node.stg.splitcortex.com` | `web-node.prd.splitcortex.com` (assumed) |

The control plane is served at `/api` on the web app host. Staging and production need DNS pointing at the Traefik load balancer.

## Business model

Bring-your-own-devices SaaS: customers enroll devices they own, we run the control plane and the gateway. Pricing is per device or pool with a free tier (not set yet).

Considered and not chosen: selling inference from our own devices (phone-class devices earn cents per day at market prices) and a public contributor/consumer marketplace (cold start, payouts and KYC, fraud, and customer prompts running on strangers' devices). Do not build marketplace, payout or commission features. If demand appears, the next step would be an invite-only mode where trusted members contribute devices to one organisation's pool.

## Roadmap

- **Larger models via local cluster mode**: an opt-in group of devices on the same LAN serving one model as a pipeline, shown to the gateway as one logical node. Sharding over the internet is not viable. An offline spike on a tiny model reproduced an unsplit model's logits exactly; nothing is built. Research notes: [docs/sharding-research.md](docs/sharding-research.md).
- More inference engines beyond LiteRT-LM (the only one for now).
- Measure tokens/sec per watt and failure rates on real devices.

## License

TBD.
