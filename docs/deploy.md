# Deployment

The frontend in this repo is deployed to S3 by the `s3-deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It uses the [s3-deploy-action](https://github.com/concord-consortium/s3-deploy-action), which uploads the built `dist/` contents to `s3://models-resources/davai-plugin/` (under a `branch/` or `version/` subfolder depending on the trigger).

Releases — promoting a built version's `index-top.html` to top-level `index.html` — are handled by the `release` workflow in [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered manually via **Actions → Release → Run workflow** with a git tag.

## AWS Access

The GitHub Actions in this project are allowed to update files in S3 using OIDC. An IAM role has been created in AWS with a trust policy that allows GitHub Actions in this specific repository to assume the role. The role has a `RepoName` tag and a managed policy that uses this tag to give the role's users permission to update files in `models-resources/davai-plugin`.

For one-time setup details (creating the IAM role, OIDC provider, shared policy), see the canonical setup doc in [starter-projects/doc/deploy-setup.md](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md).
