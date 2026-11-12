# TODO: prd cluster access is not decided yet. Replace this with the real provider
# configuration for the prd cluster. Note that HCP Terraform remote execution runs outside
# your machine, so the cluster API must be reachable from there.
provider "helm" {
  kubernetes = {
    config_path    = var.kubeconfig_path
    config_context = var.kube_context
  }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kube_context
}
