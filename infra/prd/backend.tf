# State and runs live in HCP Terraform (Terraform Cloud), workspace "prd".
# The organization is not hardcoded: set TF_CLOUD_ORGANIZATION (CI reads it from the
# GitHub variable of the same name; locally export it, and run `terraform login`).
terraform {
  cloud {
    workspaces {
      name = "prd"
    }
  }
}
