variable "environment" {
  description = "Environment name."
  type        = string
  default     = "prd"
}

variable "kubeconfig_path" {
  description = "Path to the kubeconfig used by the helm and kubernetes providers."
  type        = string
  default     = null
}

variable "kube_context" {
  description = "Kubeconfig context to use (null = the kubeconfig's current context)."
  type        = string
  default     = null
}
