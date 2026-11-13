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
    # ui/controlPlane.enabled=false: those workloads are built and deployed by Tilt below (live image substitution).
    cmd=('helm dependency build chart && helm upgrade -i --wait --timeout 5m --set ui.enabled=false --set controlPlane.enabled=false ' +
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
    '--set controlPlane.readOnlyRootFilesystem=false ' +
    # The dev image has no build output: run the migrator through tsx (cwd is /app).
    "--set 'controlPlane.migrate.command={./node_modules/.bin/tsx,src/db/migrate.ts}'",
    quiet=True,
))
# The chart runs migrations as a Helm hook (post-install/pre-upgrade); under Tilt it is a plain Job that must
# finish before the API starts.
k8s_resource('control-plane-migrate', resource_deps=['chart'], labels=['apps'])
k8s_resource('control-plane', resource_deps=['chart', 'control-plane-migrate'], labels=['apps'],
             links=['https://app.splitcortex.127.0.0.1.nip.io/api/docs'])

# Gateway (Rust; needs a direct Postgres connection for LISTEN):
#   docker_build('splitcortex/gateway', '.', dockerfile='apps/gateway/Dockerfile',
#                only=['apps/gateway', 'proto'])
# Then deploy their manifests (once the chart has workload templates) and
# set resource_deps=['chart'].
