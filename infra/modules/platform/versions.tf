terraform {
  required_version = ">= 1.9"

  # Provider configuration (kubeconfig, context, ...) is declared by each environment's
  # root module, never here. The module only states which providers it needs.
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
  }
}
