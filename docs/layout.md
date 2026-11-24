# Layout: chart and services

Rules: [CLAUDE.md](../CLAUDE.md).

## Chart (`chart/`)

`values.yaml` (local dev), `values-stg.yaml`, `values-prd.yaml` (layered with `-f`), git-ignored `values-local.yaml` (personal overrides: `cloudflareApiToken`, local Dex user hash). `Chart.lock` committed, `chart/charts/` ignored (`helm dependency build chart`). Workloads/services/ingresses/secrets sit under per-service values blocks.

**One domain setting**: `global.domain` (must be `global` so Dex's subchart sees it) is the base of `dex.`, `web-node.`, `gateway.`; the web app is on the base domain. Hosts, TLS, `controlPlane.gateway.url`, `dev.coredns.hosts` and Dex's `config` use `tpl`. Dex's config Secret is rendered by `templates/dex-config.yaml` (`dex.configSecret.create: false`); a config change needs a Dex restart.

**Dependencies** (toggled by `<name>.enabled`):

- **Traefik** 42.4.0. The `web` entryPoint redirects to `websecure` globally, so Ingresses need no redirect middleware.
- **cert-manager** v1.21.3. DNS-01 self-check uses `1.1.1.1`/`8.8.8.8` only (`--dns01-recursive-nameservers-only`); cluster DNS caches the first "no TXT yet" and challenges stall.
- **Dex** 0.26.0: `image.tag: latest` + `Always`, password DB, `skipApprovalScreen`, id tokens 15 m, refresh 2160 h, `reuseInterval: 30s` (racing renewals), Kubernetes storage. Issuer `https://dex.<domain>`; stg/prd enable Google (`${GOOGLE_CLIENT_ID}`/`${GOOGLE_CLIENT_SECRET}` via `envsubst` at deploy, never committed; redirect `https://dex.<env>/callback`). Public client `splitcortex-ui`, `allowedOrigins: ["*"]` plus `allowedHeaders`.
- **PostgreSQL** `groundhog2k/postgres` 1.6.8. `templates/postgres-credentials.yaml` generates passwords once (kept via `lookup`) into Secret `postgres-credentials` (kept on uninstall like the PVC), which also holds `DATABASE_URL`.
- **Garage**: [control-plane.md](control-plane.md).
- **ClusterIssuer** (`cluster-issuers.yaml`, post-install/upgrade hook, hence `--wait`): the single `letsencrypt`, **DNS-01 via Cloudflare**; name hardcoded, don't add issuers. Required `cloudflareApiToken` (Zone:DNS:Edit) goes into Secret `cloudflare-api-token` (also in Helm release data: keep the namespace private). stg/prd use `"${CLOUDFLARE_TOKEN}"` via `envsubst`; the template fails on a missing token or leftover placeholder (CI uses dummies). Local names resolve to `127.0.0.1` via a wildcard A record plus one for bare `local.splitcortex.com` (DNS only). Let's Encrypt allows 5 identical certs a week: recreating the local cluster often can hit that.

**Constraints**:

- The gateway needs a direct Postgres connection (`LISTEN`), not PgBouncer transaction mode. SSE and wss must not be cut by Traefik's `respondingTimeouts`. Gateway private key comes from a Secret file; prefer `existingSecret` outside dev, no inline secrets in stg/prd.
- **Dex theme**: `files/dex-theme/*` → ConfigMap `dex-theme` at `/srv/dex/web/themes/splitcortex`, selected by `dex.config.frontend` (`dir: /srv/dex/web` required). Light/dark follows the `sc-theme` cookie on the shared parent domain; `theme.js` (via our `header.html`, re-check on Dex upgrades) sets `data-theme` and swaps English strings for Romanian per `sc-lang` (unlisted stay English).
- External ingress controller: `traefik.enabled=false`, set `ingress.className` and `dex.ingress.className`, `rateLimit.enabled=false` unless Traefik CRDs, replace `traefik.ingress.kubernetes.io/*` annotations, do the HTTP→HTTPS redirect there. External cert-manager: `cert-manager.enabled=false`, `clusterIssuers.enabled=false`, point `cert-manager.io/cluster-issuer` at yours.
- **Rate limits** (`rate-limits.yaml`): `rate-limit-general` (per IP, 50/s burst 100; web app, control plane, Dex), `rate-limit-gateway` (per `Authorization`, 2000/s burst 4000, flood ceiling only), `rate-limit-node` (per IP, 100/s burst 500) on `/node` via its own Ingress (`gateway-node-ingress.yaml`) because nodes send no `Authorization`. **Not on the entryPoint**: attach per route. **`noindex`** (`noindex.yaml`): Traefik headers middleware (`X-Robots-Tag: noindex, nofollow, noarchive`) next to the rate limit on Dex, web node, control plane, gateway and `/v1`; the web app decides itself ([ui.md](ui.md)).
- Dev only (`dev.coredns.enabled`): `coredns-custom.yaml` rewrites hosts in `dev.coredns.hosts` (Dex) to Traefik, since pods would resolve `127.0.0.1` to themselves. Replaces any existing `coredns-custom`.
- No Redis, no serverless. Enrollment goes through the control plane ingress, never the gateway.

## Services

- `src/ui/`, `src/web-node/` (chart `webNode:`; the control plane's Ingress also lists the web node host for `/api`, TLS Secret `web-node-tls`), `src/control-plane/` (`src/app.ts` builds the app from injected `db` and token verifier, so tests need no infrastructure), `src/gateway/`: see their docs. Chart files `<svc>-*.yaml` under `<svc>:`.
- `src/mobile-node/`, `src/cli-node/`: **not deployed by the chart**; built by `.github/workflows/` ([commands-and-ci.md](commands-and-ci.md)).
- Android emulator: local hostnames resolve to the emulator itself; use `adb reverse tcp:443 tcp:443`. Certs are publicly trusted, no CA config needed.
