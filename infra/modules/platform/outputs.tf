output "root_ca_issuer_name" {
  description = "Name of the self-signed root CA ClusterIssuer."
  value       = "root-ca-issuer"

  depends_on = [helm_release.root_ca_issuer]
}

output "letsencrypt_issuer_name" {
  description = "Name of the Let's Encrypt ClusterIssuer, or null when disabled."
  value       = var.enable_letsencrypt ? "letsencrypt" : null

  depends_on = [helm_release.letsencrypt_issuer]
}
