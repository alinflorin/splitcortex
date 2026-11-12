# Modules

Reusable Terraform modules shared by `dev`, `stg` and `prd`. One directory per module
(`modules/<name>/{variables,outputs,versions}.tf` plus one file per component, e.g. `platform/traefik.tf`).

| Module     | Purpose                                                                          |
|------------|----------------------------------------------------------------------------------|
| `platform` | Cluster platform components: Traefik, cert-manager, ClusterIssuers (self-signed `root-ca-issuer`, optional `letsencrypt`). |

Modules never configure providers. Each environment declares its own `helm` and `kubernetes`
provider configuration (see `<env>/providers.tf`), because the target cluster differs.

`platform` ClusterIssuers are installed through small local charts (`platform/charts/`), not
`kubernetes_manifest`, because that resource needs the cert-manager CRDs at plan time and would
fail a first apply on a fresh cluster. Bump the chart `version` in `Chart.yaml` when you change a
local chart, otherwise Helm will not see the change. `letsencrypt` is off by default
(`enable_letsencrypt`), is never enabled in dev, and depends on Traefik.
