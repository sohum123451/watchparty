# GitHub Actions Workflows for WatchParty

This directory contains the continuous integration, testing, and AWS Graviton2 deployment workflows for WatchParty:

1. **`ci.yml`**: Runs full monorepo linting, typechecks, and the 526-test suite across client, server, extension, and shared packages.
2. **`ci-cd.yml`**: Multi-stage pipeline that tests and builds production Docker images.
3. **`deploy-aws.yml`**: Automated zero-downtime deployment to the EC2 Graviton2 ARM instance via AWS Systems Manager (SSM) with automatic rollback on healthcheck failure.

### Enabling in GitHub Actions

To activate these workflows on GitHub:
1. Copy or move these `.yml` files into `.github/workflows/`
2. Configure your repository secrets under **Settings > Secrets and variables > Actions**:
   - `AWS_ROLE_TO_ASSUME` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
   - `EC2_INSTANCE_ID` (`i-0b619d3502fe9aea2`)
   - `AWS_REGION` (`ap-south-1`)
