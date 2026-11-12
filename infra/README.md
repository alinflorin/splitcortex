# Infrastructure

Terraform, one root module per environment plus shared modules:

| Path       | Purpose                                                              |
|------------|----------------------------------------------------------------------|
| `dev/`     | Local provisioning only. Never run from CI. Local state (gitignored). |
| `stg/`     | Staging. Planned and applied by GitHub Actions.                      |
| `prd/`     | Production. Planned and applied by GitHub Actions.                   |
| `modules/` | Shared modules used by the environments.                             |

Status: bootstrap only. No provider or resources yet.

State: `stg` and `prd` use HCP Terraform (Terraform Cloud) via a `cloud` block, workspaces
`stg` and `prd` (remote execution mode). The organization is not hardcoded; set
`TF_CLOUD_ORGANIZATION` (and run `terraform login` locally). Provider credentials belong in
the HCP Terraform workspace variables, not in GitHub.

## Local (dev)

```sh
cd infra/dev
terraform init
terraform plan
terraform apply
```

## CI/CD

Workflow: `.github/workflows/terraform.yml`.

| Trigger                      | What runs                                                          |
|------------------------------|--------------------------------------------------------------------|
| PR to `main` (infra changes) | fmt + validate, then plan stg and prd. No apply.                   |
| Push to `main`               | fmt + validate, plan stg and prd, then apply stg, then apply prd.  |
| Manual (`workflow_dispatch`) | Choose `stg` or `prd`, and plan-only or apply. Apply only on `main`. |

The jobs are generic: a matrix value (`stg`, `prd`) selects the directory, the GitHub
environment and the HCP Terraform workspace. The saved plan from the plan job is what the apply
job applies (no re-plan). Only plans with changes are uploaded; an environment without one is
skipped in the apply job, though its `tf-<env>-apply` approval gate still triggers.

Concurrency: one run per ref at a time (`terraform-<ref>`). A newer PR push cancels the
older run; runs on `main` queue instead of cancelling, so an apply is never cut off
mid-way (GitHub keeps only the newest queued run, which contains the older commits).

Caching: downloaded providers are cached with `TF_PLUGIN_CACHE_DIR` and `actions/cache`,
keyed on each environment's `.terraform.lock.hcl`. Commit that lock file once providers
exist. Local `modules/` are in the repo and need no caching.

### GitHub environments (create these in repo settings)

Two sets per environment so plan and apply can have different credentials and protection:

| Environment | Use      | Suggested settings                                        |
|-------------|----------|-----------------------------------------------------------|
| `tf-stg-plan`  | plan job | Read-only cloud role. No reviewers.                       |
| `tf-stg-apply` | apply job| Write role. Restrict to `main`; optional reviewers.       |
| `tf-prd-plan`  | plan job | Read-only cloud role. No reviewers.                       |
| `tf-prd-apply` | apply job| Write role. Restrict to `main`; required reviewers.       |

Setup:
- Repository (or per-environment) variable `TF_CLOUD_ORGANIZATION`: the HCP Terraform org name.
- Secret `TF_TOKEN` in each of the four environments: a team token that can plan in the `tf-*-plan` environments and apply in the `tf-*-apply` environments.
- The apply job applies the saved HCP Terraform plan from the plan job (needs Terraform >= 1.6 and remote execution mode).
