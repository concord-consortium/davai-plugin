# Deployment

The frontend in this repo is deployed to S3 by the `s3-deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It uses the [s3-deploy-action](https://github.com/concord-consortium/s3-deploy-action), which uploads the built `dist/` contents to `s3://models-resources/davai-plugin/` (under a `branch/` or `version/` subfolder depending on the trigger).

Releases — promoting a built version's `index-top.html` to top-level `index.html` — are handled by the `release` workflow in [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered manually via **Actions → Release → Run workflow** with a git tag.

## The frontend's server URL

The client talks to the LLM backend at a URL baked in **at build time** from the `LANGCHAIN_SERVER_URL` environment variable (with `AUTH_TOKEN` for auth), via webpack's `EnvironmentPlugin`. There is no runtime override. In CI this comes from a **single shared `LANGCHAIN_SERVER_URL` GitHub Actions secret**, so every build CI produces — `main` and all branch previews alike — bakes in the **same** server URL (currently the **production** stack). There is no per-branch server. See [Environments and the LLM server](../README.md#environments-and-the-llm-server) for the developer-facing view.

## Server (sam-server) deployment

The backend in [`/sam-server`](../sam-server) is **not deployed by CI** — only the frontend is. The server is deployed **manually** from a developer's machine to one of three independent CloudFormation stacks, each with its own database and secrets:

| Environment | Stack | Command (run in `sam-server/`) |
|---|---|---|
| Production | `davai-server` | `npm run sam:deploy` |
| Staging A | `davai-server-staging-a` | `npm run sam:deploy:staging-a` |
| Staging B | `davai-server-staging-b` | `npm run sam:deploy:staging-b` |

The exact endpoints, database names, and parameters per stack are in [`../sam-server/samconfig.toml`](../sam-server/samconfig.toml). Because each stack has its own database, schema changes (the `setup` handler / SQL) must be applied to each environment you deploy to.

## Promoting a change to production

Frontend and server promote through **separate** paths, and there is no atomic frontend+server release:

1. **Frontend** — merge the branch to `main` (PR). CI builds and deploys it to `branch/main/`. To cut the canonical released `index.html`, run the manual **Release** workflow (above) with a git tag.
2. **Server** — merging to `main` does **nothing** to any server. Separately run `npm run sam:deploy` (from `sam-server/`) to deploy your changes to the production stack `davai-server`, plus any production DB migration.
3. **Sequence for compatibility** — production is live and shared, and `sam deploy` takes effect immediately. Deploy backward-compatible server changes before the frontend that depends on them, and validate on staging-a/b first.

## AWS Access

The GitHub Actions in this project are allowed to update files in S3 using OIDC. An IAM role has been created in AWS with a trust policy that allows GitHub Actions in this specific repository to assume the role. The role has a `RepoName` tag and a managed policy that uses this tag to give the role's users permission to update files in `models-resources/davai-plugin`.

For one-time setup details (creating the IAM role, OIDC provider, shared policy), see the canonical setup doc in [starter-projects/doc/deploy-setup.md](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md).
