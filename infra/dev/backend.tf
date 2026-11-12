# dev is provisioned locally only (never from CI): local state, which is gitignored.
terraform {
  backend "local" {}
}
