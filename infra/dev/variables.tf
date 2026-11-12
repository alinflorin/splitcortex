variable "environment" {
  description = "Environment name."
  type        = string
  default     = "dev"
}

variable "kubeconfig_path" {
  description = "Path to the kubeconfig used by the helm and kubernetes providers."
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "Kubeconfig context to use (null = the kubeconfig's current context)."
  type        = string
  default     = null
}
