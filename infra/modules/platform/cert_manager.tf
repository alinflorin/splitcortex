# TLS certificate management. CRDs are installed (and kept on uninstall) by the chart.
resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = var.cert_manager_chart_version
  namespace        = var.cert_manager_namespace
  create_namespace = true

  atomic          = true
  cleanup_on_fail = true

  values = [
    yamlencode({
      crds = {
        enabled = true
        keep    = true
      }
    }),
  ]
}
