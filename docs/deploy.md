# Deployment

The frontend in this repo is deployed to S3 by the `s3-deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It uses the [s3-deploy-action](https://github.com/concord-consortium/s3-deploy-action), which uploads the built `dist/` contents to `s3://models-resources/davai-plugin/` (under a `branch/` or `version/` subfolder depending on the trigger).

Releases — promoting a built version's `index-top.html` to top-level `index.html` — are handled by the `release` workflow in [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered manually via **Actions → Release → Run workflow** with a git tag.

## The frontend's server URL

The client talks to the LLM backend at a URL baked in **at build time** from the `LANGCHAIN_SERVER_URL` environment variable (with `AUTH_TOKEN` for auth), via webpack's `EnvironmentPlugin`. There is no runtime override. In CI the value is **chosen by git ref**: **version tags** (production releases) use the prod `LANGCHAIN_SERVER_URL` / `AUTH_TOKEN` secrets, while **every other ref — all branches, including `main`** — uses the `STAGING_LANGCHAIN_SERVER_URL` / `STAGING_AUTH_TOKEN` secrets (staging-a). So branch previews talk to **staging-a** and only a **tagged release** talks to **prod**. See [Environments and the LLM server](../README.md#environments-and-the-llm-server) for the developer-facing view.

## Server (sam-server) deployment

The backend in [`/sam-server`](../sam-server) is **not deployed by CI** — only the frontend is. The server is deployed **manually** from a developer's machine to one of three independent CloudFormation stacks, each with its own database and secrets:

| Environment | Stack | Command (run in `sam-server/`) |
|---|---|---|
| Production | `davai-server` | `npm run sam:deploy` |
| Staging A | `davai-server-staging-a` | `npm run sam:deploy:staging-a` |
| Staging B | `davai-server-staging-b` | `npm run sam:deploy:staging-b` |

The exact endpoints, database names, and parameters per stack are in [`../sam-server/samconfig.toml`](../sam-server/samconfig.toml). Because each stack has its own database, schema changes (the `setup` handler / SQL) must be applied to each environment you deploy to.

## Promoting a change to production

Frontend and server promote through **separate** paths, and there is no atomic frontend+server release. Because only a **tagged release** points the frontend at the prod server, deploy the server first:

1. **Server first** — deploy any required server changes to production: from `sam-server/`, `npm run sam:build` then `npm run sam:deploy` (the `[default]` / `davai-server` stack), plus any production DB migration. Validate on staging-a first. (Merging to `main` does **nothing** to any server.)
2. **Then tag & release the frontend** — push a version tag; its CI build bakes in the **prod** server URL (branch builds, including `branch/main/`, point at staging-a). Run the manual **Release** workflow (above) to promote that tagged build to the production `index.html`.
3. **Why this order** — production is live and shared, and the released frontend hits prod immediately. If you tag before the prod server is updated, the new frontend talks to an out-of-date server. Deploy backward-compatible server changes ahead of the frontend that depends on them.

## AWS Access

The GitHub Actions in this project are allowed to update files in S3 using OIDC. An IAM role has been created in AWS with a trust policy that allows GitHub Actions in this specific repository to assume the role. The role has a `RepoName` tag and a managed policy that uses this tag to give the role's users permission to update files in `models-resources/davai-plugin`.

For one-time setup details (creating the IAM role, OIDC provider, shared policy), see the canonical setup doc in [starter-projects/doc/deploy-setup.md](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md).
