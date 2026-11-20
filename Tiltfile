# -*- mode: Python -*-
# Local dev loop for SplitCortex on k3s with a Docker registry at localhost:5000
# (k3s mirrors "localhost:5000" via /etc/rancher/k3s/registries.yaml).

allow_k8s_contexts('default')  # k3s kubeconfig context name
default_registry('localhost:5000')

NAMESPACE = 'splitcortex'

# --- Infra chart (Traefik, cert-manager, Postgres, ClusterIssuers) ---------
# Installed with `helm upgrade --wait` instead of tilt's helm() because the
# ClusterIssuer hooks must run after the cert-manager webhook is ready, which
# `helm template` + kubectl apply cannot guarantee.
helm_values = ['chart/values-local.yaml'] if os.path.exists('chart/values-local.yaml') else []
values_args = ' '.join(['-f ' + v for v in helm_values])

local_resource(
    'chart',
    # ui/webNode/controlPlane.enabled=false: those workloads are built and deployed by Tilt below (live image substitution).
    # Repos are derived from Chart.yaml (same as CI) so a new dependency never needs a manual `helm repo add`.
    cmd=("grep -E '^\\s+repository:' chart/Chart.yaml | awk '{print $2}' | sort -u | while read -r url; do " +
         "helm repo add \"$(echo \"$url\" | sed -E 's#https?://##; s#[^A-Za-z0-9]+#-#g; s#-$##')\" \"$url\" --force-update >/dev/null; done && " +
         'helm dependency build chart && helm upgrade -i --wait --timeout 5m --set ui.enabled=false --set webNode.enabled=false --set controlPlane.enabled=false --set gateway.enabled=false ' +
         # Dev-only: the Vite dev server serves hundreds of unbundled modules per page load, which the default per-IP
         # limit (50/s, burst 100) answers with 429.
         '--set rateLimit.general.average=1000 --set rateLimit.general.burst=2000 ' +
         '--create-namespace -n %s %s splitcortex chart' % (NAMESPACE, values_args)),
    deps=['chart/Chart.yaml', 'chart/Chart.lock', 'chart/values.yaml', 'chart/templates'] + helm_values,
    labels=['infra'],
)

# --- Services (add as code lands) ------------------------------------------
# Web UI (src/ui, Caddy serving the Vite build). The manifests come from the chart's ui-* templates rendered
# with `helm template`, so Tilt substitutes the freshly built image for `splitcortex/ui`.
# Dev image (Dockerfile.dev) runs the Vite dev server with HMR; source edits are synced, no rebuild.
docker_build(
    'splitcortex/ui', 'src/ui', dockerfile='src/ui/Dockerfile.dev',
    live_update=[
        fall_back_on(['src/ui/package.json', 'src/ui/pnpm-lock.yaml', 'src/ui/vite.config.ts']),
        sync('src/ui/src', '/app/src'),
        sync('src/ui/public', '/app/public'),
        sync('src/ui/index.html', '/app/index.html'),
    ],
)
k8s_yaml(local(
    'helm template splitcortex chart -n %s %s ' % (NAMESPACE, values_args) +
    '--show-only templates/ui-deployment.yaml --show-only templates/ui-service.yaml ' +
    '--set ui.readOnlyRootFilesystem=false ' +
    '--show-only templates/ui-ingress.yaml',
    quiet=True,
))
k8s_resource('ui', resource_deps=['chart'], labels=['apps'], links=['https://app.splitcortex.127.0.0.1.nip.io'])

# Web node (src/web-node, a browser that serves inference like a phone node). Same shape as the UI: the dev image runs
# Vite with HMR on 8080 and live_update syncs sources. Its host also routes /api to the control plane (chart values).
docker_build(
    'splitcortex/web-node', 'src/web-node', dockerfile='src/web-node/Dockerfile.dev',
    live_update=[
        fall_back_on(['src/web-node/package.json', 'src/web-node/pnpm-lock.yaml', 'src/web-node/vite.config.ts']),
        sync('src/web-node/src', '/app/src'),
        sync('src/web-node/public', '/app/public'),
        sync('src/web-node/index.html', '/app/index.html'),
    ],
)
k8s_yaml(local(
    'helm template splitcortex chart -n %s %s ' % (NAMESPACE, values_args) +
    '--show-only templates/web-node-deployment.yaml --show-only templates/web-node-service.yaml ' +
    '--set webNode.readOnlyRootFilesystem=false ' +
    '--show-only templates/web-node-ingress.yaml',
    quiet=True,
))
k8s_resource('web-node', resource_deps=['chart'], labels=['apps'], links=['https://web-node.splitcortex.127.0.0.1.nip.io'])

# Control plane (src/control-plane, Fastify + Drizzle). The dev image runs `tsx watch`; src edits are synced.
# Changes under src/control-plane/drizzle (new migrations) are deliberately NOT synced, so they rebuild the image
# and re-create the migration Job.
docker_build(
    'splitcortex/control-plane', 'src/control-plane', dockerfile='src/control-plane/Dockerfile.dev',
    live_update=[
        fall_back_on(['src/control-plane/package.json', 'src/control-plane/pnpm-lock.yaml', 'src/control-plane/pnpm-workspace.yaml',
                      'src/control-plane/tsconfig.json']),
        sync('src/control-plane/src', '/app/src'),
    ],
)
k8s_yaml(local(
    'helm template splitcortex chart -n %s %s ' % (NAMESPACE, values_args) +
    '--show-only templates/control-plane-deployment.yaml --show-only templates/control-plane-service.yaml ' +
    '--show-only templates/control-plane-ingress.yaml --show-only templates/control-plane-migrate-job.yaml ' +
    '--show-only templates/garage-bootstrap-job.yaml --show-only templates/control-plane-sweep-cronjob.yaml ' +
    '--show-only templates/control-plane-audit-prune-cronjob.yaml --show-only templates/control-plane-metrics-prune-cronjob.yaml ' +
    '--set controlPlane.readOnlyRootFilesystem=false ' +
    # The dev image has no build output: run the migrator through tsx (cwd is /app).
    "--set 'controlPlane.migrate.command={./node_modules/.bin/tsx,src/db/migrate.ts}' " +
    "--set 'garage.bootstrap.command={./node_modules/.bin/tsx,src/storage/bootstrap-cli.ts}' " +
    "--set 'controlPlane.sweep.command={./node_modules/.bin/tsx,src/storage/sweep-cli.ts}' " +
    "--set 'controlPlane.auditPrune.command={./node_modules/.bin/tsx,src/db/audit-prune-cli.ts}' " +
    "--set 'controlPlane.metricsPrune.command={./node_modules/.bin/tsx,src/db/metrics-prune-cli.ts}'",
    quiet=True,
))
# The chart runs migrations as a Helm hook (post-install/pre-upgrade); under Tilt it is a plain Job that must
# finish before the API starts.
k8s_resource('control-plane-migrate', resource_deps=['chart'], labels=['apps'])
# Same for the Garage bootstrap Job (layout, key, bucket): a plain Job under Tilt, run with the control plane image.
k8s_resource('garage-bootstrap', resource_deps=['chart'], labels=['apps'])
# The abandoned-upload sweeper CronJob (daily; trigger it manually from the Tilt UI).
k8s_resource('control-plane-sweep', resource_deps=['chart'], labels=['apps'], auto_init=False)
# Audit log retention CronJob (daily; trigger it manually from the Tilt UI).
k8s_resource('control-plane-audit-prune', resource_deps=['chart'], labels=['apps'], auto_init=False)
# Metrics retention CronJob (hourly; trigger it manually from the Tilt UI).
k8s_resource('control-plane-metrics-prune', resource_deps=['chart'], labels=['apps'], auto_init=False)
k8s_resource('control-plane', resource_deps=['chart', 'control-plane-migrate', 'garage-bootstrap', 'gateway-identity'], labels=['apps'],
             links=['https://app.splitcortex.127.0.0.1.nip.io/api/docs'])

# Gateway (src/gateway, Rust). The dev image runs `cargo watch`; src/ and proto/ are synced and it rebuilds + restarts
# (a first build in the container takes a few minutes). Needs the migrated database, like the control plane.
docker_build(
    'splitcortex/gateway', 'src/gateway', dockerfile='src/gateway/Dockerfile.dev',
    live_update=[
        fall_back_on(['src/gateway/Cargo.toml', 'src/gateway/Cargo.lock', 'src/gateway/build.rs']),
        sync('src/gateway/src', '/app/src'),
        sync('src/gateway/proto', '/app/proto'),
    ],
)
k8s_yaml(local(
    'helm template splitcortex chart -n %s %s ' % (NAMESPACE, values_args) +
    '--show-only templates/gateway-deployment.yaml --show-only templates/gateway-service.yaml ' +
    '--show-only templates/gateway-ingress.yaml --show-only templates/gateway-app-ingress.yaml --show-only templates/gateway-node-ingress.yaml --show-only templates/gateway-identity-job.yaml ' +
    '--set gateway.readOnlyRootFilesystem=false ' +
    # The dev image has no installed binary: run keygen through cargo (cwd is /app).
    "--set 'gateway.identity.command={cargo,run,-q,--}'",
    quiet=True,
))
# The identity Job (a Helm hook in a real install) creates the gateway's key Secrets once; a plain Job under Tilt.
k8s_resource('gateway-identity', resource_deps=['chart'], labels=['apps'])
k8s_resource('gateway', resource_deps=['chart', 'control-plane-migrate', 'gateway-identity'], labels=['apps'],
             links=['https://gateway.splitcortex.127.0.0.1.nip.io/v1/models'])
