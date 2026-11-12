# Ingress controller. WebSocket (wss) and SSE pass through Traefik without extra config.
resource "helm_release" "traefik" {
  name             = "traefik"
  repository       = "https://traefik.github.io/charts"
  chart            = "traefik"
  version          = var.traefik_chart_version
  namespace        = var.traefik_namespace
  create_namespace = true

  atomic          = true
  cleanup_on_fail = true

  values = var.traefik_values
}
