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
    cmd=('helm dependency build chart && helm upgrade -i --wait --timeout 5m ' +
         '--create-namespace -n %s %s splitcortex chart' % (NAMESPACE, values_args)),
    deps=['chart/Chart.yaml', 'chart/Chart.lock', 'chart/values.yaml', 'chart/templates'] + helm_values,
    labels=['infra'],
)

# --- Services (add as code lands) ------------------------------------------
# Control plane (Fastify):
#   docker_build('splitcortex/control-plane', '.', dockerfile='apps/control-plane/Dockerfile',
#                only=['apps/control-plane', 'packages/shared'])
# Gateway (Rust; needs a direct Postgres connection for LISTEN):
#   docker_build('splitcortex/gateway', '.', dockerfile='apps/gateway/Dockerfile',
#                only=['apps/gateway', 'proto'])
# Then deploy their manifests (once the chart has workload templates) and
# set resource_deps=['chart'].
