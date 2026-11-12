# Self-signed root CA, usable in every environment (e.g. local dev without Let's Encrypt).
# Installed through a local chart because kubernetes_manifest needs the cert-manager CRDs to
# exist at plan time, which breaks a single-pass apply on a fresh cluster.
#
# Bootstrap chain: selfsigned-bootstrap (ClusterIssuer) -> root-ca (Certificate, isCA)
#                  -> root-ca-issuer (ClusterIssuer backed by the root-ca secret).
resource "helm_release" "root_ca_issuer" {
  name      = "root-ca-issuer"
  chart     = "${path.module}/charts/root-ca-issuer"
  namespace = var.cert_manager_namespace

  atomic          = true
  cleanup_on_fail = true

  values = [
    yamlencode({
      issuerName = "root-ca-issuer"
      namespace  = var.cert_manager_namespace
    }),
  ]

  depends_on = [helm_release.cert_manager]
}
