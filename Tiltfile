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
    # ui.enabled=false: the UI workload is built and deployed by Tilt below (live image substitution).
    cmd=('helm dependency build chart && helm upgrade -i --wait --timeout 5m --set ui.enabled=false ' +
         '--create-namespace -n %s %s splitcortex chart' % (NAMESPACE, values_args)),
    deps=['chart/Chart.yaml', 'chart/Chart.lock', 'chart/values.yaml', 'chart/templates'] + helm_values,
    labels=['infra'],
)

# --- Services (add as code lands) ------------------------------------------
# Web UI (src/ui, Caddy serving the Vite build). The manifests come from the chart's ui-* templates rendered
# with `helm template`, so Tilt substitutes the freshly built image for `splitcortex/ui`.
docker_build('splitcortex/ui', 'src/ui', dockerfile='src/ui/Dockerfile')
k8s_yaml(local(
    'helm template splitcortex chart -n %s %s ' % (NAMESPACE, values_args) +
    '--show-only templates/ui-deployment.yaml --show-only templates/ui-service.yaml ' +
    '--show-only templates/ui-ingress.yaml',
    quiet=True,
))
k8s_resource('ui', resource_deps=['chart'], labels=['apps'], links=['https://app.splitcortex.127.0.0.1.nip.io'])

# Control plane (Fastify):
#   docker_build('splitcortex/control-plane', '.', dockerfile='apps/control-plane/Dockerfile',
#                only=['apps/control-plane', 'packages/shared'])
# Gateway (Rust; needs a direct Postgres connection for LISTEN):
#   docker_build('splitcortex/gateway', '.', dockerfile='apps/gateway/Dockerfile',
#                only=['apps/gateway', 'proto'])
# Then deploy their manifests (once the chart has workload templates) and
# set resource_deps=['chart'].
