# Let's Encrypt ACME ClusterIssuer (HTTP-01 through the Traefik ingress class), optional.
# Not enabled in dev. It depends on Traefik, which has to serve the HTTP-01 challenge.
resource "helm_release" "letsencrypt_issuer" {
  count = var.enable_letsencrypt ? 1 : 0

  name      = "letsencrypt-issuer"
  chart     = "${path.module}/charts/letsencrypt-issuer"
  namespace = var.cert_manager_namespace

  atomic          = true
  cleanup_on_fail = true

  values = [
    yamlencode({
      issuerName   = "letsencrypt"
      email        = var.letsencrypt_email
      server       = "https://acme-v02.api.letsencrypt.org/directory"
      ingressClass = "traefik"
    }),
  ]

  depends_on = [
    helm_release.cert_manager,
    helm_release.traefik,
  ]
}
