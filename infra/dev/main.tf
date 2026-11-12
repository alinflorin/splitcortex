# Root module for the "dev" environment. Compose modules from ../modules here.
locals {
  environment = var.environment
}

module "platform" {
  source = "../modules/platform"

  environment = local.environment

}
