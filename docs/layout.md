# Layout: chart and services

Rules: [CLAUDE.md](../CLAUDE.md).

## Chart (`chart/`)

`Chart.yaml`, `templates/_helpers.tpl`, `values.yaml` (local dev), `values-stg.yaml`, `values-prd.yaml` (layered with `-f`), git-ignored `values-local.yaml` (personal overrides, incl. `cloudflareApiToken` and the local Dex user hash). `Chart.lock` committed, `chart/charts/` git-ignored (`helm dependency build chart`). Workloads, services, ingresses and secrets sit under per-service values blocks.

**One domain setting**: `global.domain` (must be `global` so Dex's subchart sees it) is the base of `dex.`, `web-node.`, `gateway.`; the web app is on the base domain itself. Ingress hosts/TLS, `controlPlane.gateway.url`, `dev.coredns.hosts` and Dex's `config` are rendered with `tpl` (`"dex.{{ .Values.global.domain }}"`). Dex's config Secret is rendered by `templates/dex-config.yaml` (`dex.configSecret.create: false`); a config change needs a Dex restart.

**Dependencies** (each toggled by `<name>.enabled`):

- **Traefik** 42.4.0, IngressClass `traefik`. The `web` entryPoint redirects everything to `websecure` globally, so Ingresses need no redirect middleware.
- **cert-manager** v1.21.3, CRDs enabled. DNS-01 self-check uses `1.1.1.1`/`8.8.8.8` only (`--dns01-recursive-nameservers-only`), since the cluster DNS caches the first "no TXT yet" and challenges stall for minutes.
- **Dex** 0.26.0: `image.tag: latest` + `pullPolicy: Always`, password DB, `skipApprovalScreen`, id tokens 15 m, refresh 2160 h, `reuseInterval: 30s` (racing renewals), Kubernetes storage. Issuer `https://dex.<domain>`; stg/prd enable the Google connector (`${GOOGLE_CLIENT_ID}`/`${GOOGLE_CLIENT_SECRET}` substituted by `envsubst` at deploy time, never committed; redirect `https://dex.<env>/callback`). Each env registers the public `splitcortex-ui` client, `allowedOrigins: ["*"]` and an `allowedHeaders` list.
- **PostgreSQL** `groundhog2k/postgres` 1.6.8, service `postgres`. `templates/postgres-credentials.yaml` generates random passwords once (kept via `lookup`) into Secret `postgres-credentials` (kept on uninstall, like the PVC), which also carries `DATABASE_URL`.
- **Garage**: [control-plane.md](control-plane.md).
- **ClusterIssuer** (`templates/cluster-issuers.yaml`, post-install/upgrade hook, hence `--wait`): the single `letsencrypt`, **DNS-01 via Cloudflare**, no self-signed or HTTP-01 issuer, no ACME email; name hardcoded, don't add issuers to values. Required `cloudflareApiToken` (Zone:DNS:Edit) is rendered into Secret `cloudflare-api-token` (also in Helm release data: keep the namespace private). Local: `values-local.yaml`; stg/prd: `"${CLOUDFLARE_TOKEN}"` via `envsubst`; the template fails on a missing token or leftover placeholder (CI uses dummies). Local names resolve to `127.0.0.1` through a wildcard A record plus one for the bare `local.splitcortex.com` (DNS only, in Cloudflare), so certificates are publicly trusted. Let's Encrypt allows 5 identical certificates a week: recreating the local cluster often can hit that.

**Constraints**:

- The gateway needs a direct Postgres connection (`LISTEN`), not PgBouncer transaction mode. Default 1 replica ([gateway.md](gateway.md)). SSE and wss must not be cut by Traefik's `respondingTimeouts`. The gateway private key comes from a Secret file; prefer `existingSecret` outside dev, no inline secrets in stg/prd.
- **Dex theme**: `files/dex-theme/*` rendered by `templates/dex-theme.yaml` into ConfigMap `dex-theme`, mounted at `/srv/dex/web/themes/splitcortex` and selected by `dex.config.frontend` (`dir: /srv/dex/web` is required). Light/dark follows the `sc-theme` cookie the web app writes on the shared parent domain; `theme.js` (loaded by our `header.html`, re-check on Dex upgrades) sets `data-theme`, and swaps Dex's English strings for Romanian per the `sc-lang` cookie (Dex has no i18n; unlisted strings stay English). Not yet checked on a running Dex.
- External ingress controller: `traefik.enabled=false`, set `ingress.className` and `dex.ingress.className`, `rateLimit.enabled=false` unless Traefik with CRDs, replace `traefik.ingress.kubernetes.io/*` annotations, configure the HTTP→HTTPS redirect there. External cert-manager: `cert-manager.enabled=false` and `clusterIssuers.enabled=false`, point `cert-manager.io/cluster-issuer` at yours.
- **Rate limits** (`templates/rate-limits.yaml`, `rateLimit`): `rate-limit-general` (per IP, 50/s burst 100; web app, control plane, Dex), `rate-limit-gateway` (per `Authorization`, 2000/s burst 4000, only a flood ceiling), `rate-limit-node` (per IP, 100/s burst 500) on `/node` through its own Ingress (`templates/gateway-node-ingress.yaml`, `gateway.nodeIngress`) because nodes send no `Authorization`. **Not on the entryPoint**: attach per route. **`noindex`** (`templates/noindex.yaml`): a Traefik headers middleware (`X-Robots-Tag: noindex, nofollow, noarchive`) attached next to the rate limit on Dex, web node, control plane (`/api`), gateway and `/v1` Ingresses; the web app decides for itself (`ui.seo.indexable`, true only in `values-prd.yaml`, see [ui.md](ui.md)).
- Dev only (`dev.coredns.enabled`, off in stg/prd): `templates/coredns-custom.yaml` rewrites each host in `dev.coredns.hosts` (currently Dex) to Traefik in k3s' `coredns-custom`, since pods would otherwise resolve `127.0.0.1` to themselves. Replaces any existing `coredns-custom`.
- No Redis, no serverless. Enrollment goes through the control plane ingress, never the gateway.

## Services

- `src/ui/`: [ui.md](ui.md). `Dockerfile` + `Dockerfile.dev`, chart `ui-*.yaml` under `ui:`.
- `src/web-node/`: [web-node.md](web-node.md). Chart `web-node-*.yaml` under `webNode:`; the control plane's Ingress also lists the web node host (`/api` only; TLS Secret `web-node-tls`).
- `src/control-plane/`: `src/app.ts` builds the app from injected `db` and token verifier (tests need no infrastructure); `routes/`, `plugins/`, `dto/`, `db/`, `drizzle/`. Chart `control-plane-{deployment,service,ingress,migrate-job}.yaml` under `controlPlane:`. [control-plane.md](control-plane.md).
- `src/gateway/`: [gateway.md](gateway.md); chart `gateway-*` under `gateway:`.
- `src/mobile-node/`, `src/cli-node/`: device apps, **not deployed by the chart**; built by `.github/workflows/` ([commands-and-ci.md](commands-and-ci.md)).
- Android emulator: local hostnames resolve to the emulator itself, so forward with `adb reverse tcp:443 tcp:443`. Certificates are publicly trusted, so no CA or network security config is needed.
