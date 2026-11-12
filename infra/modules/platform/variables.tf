variable "environment" {
  description = "Environment name (dev, stg, prd)."
  type        = string
}

variable "traefik_chart_version" {
  description = "Version of the Traefik Helm chart."
  type        = string
  default     = "42.4.0"
}

variable "traefik_namespace" {
  description = "Namespace Traefik is installed into (created if missing)."
  type        = string
  default     = "traefik"
}

variable "traefik_values" {
  description = "Extra Helm values for Traefik, as YAML documents (later entries win)."
  type        = list(string)
  default     = []
}

variable "cert_manager_chart_version" {
  description = "Version of the cert-manager Helm chart."
  type        = string
  default     = "v1.21.3"
}

variable "cert_manager_namespace" {
  description = "Namespace cert-manager is installed into (created if missing). Also holds the root CA secret."
  type        = string
  default     = "cert-manager"
}

variable "enable_letsencrypt" {
  description = "Create the Let's Encrypt ClusterIssuer (requires letsencrypt_email). Keep off in dev."
  type        = bool
  default     = false
}

variable "letsencrypt_email" {
  description = "ACME account email for Let's Encrypt."
  type        = string
  default     = null

  validation {
    condition     = !var.enable_letsencrypt || var.letsencrypt_email != null
    error_message = "letsencrypt_email is required when enable_letsencrypt is true."
  }
}
