# infra/ — the AgentCore stacks

[cloudformation.yml](cloudformation.yml) defines a stack: the AgentCore runtime that runs the
`backend/` container image, the runtime's execution role, and a Cognito identity pool whose
unauthenticated role may invoke only that runtime. The stacks are managed with the AWS CLI. CI does
not deploy them.

There are two stacks:

| stack | account | used by |
|---|---|---|
| `davai-agentcore-staging` | QA (816253370536) | testing branches |
| `davai-agentcore-production` | main (612297603577) | release candidates and releases |

The scripts in this folder use the AWS profile named `agentcore` for staging and the default profile
for production. To use a profile with another name, set `AWS_PROFILE`. Before doing anything, each
script checks that the profile's credentials are for the stack's account, and stops if they aren't.

[DEPLOYED.md](DEPLOYED.md) records each stack's fixed details (runtime ARN, identity pool, roles)
and how to tear it down. `./infra/status.sh <staging|production>` shows what each endpoint is
running.

## Versions and endpoints

Every change to a runtime (a new image, new environment variables) creates a new, numbered runtime
version. A runtime's `DEFAULT` endpoint always serves the newest version.

The production stack also has a `production` endpoint, which stays on one version until it is
promoted. Release candidates are tested on `DEFAULT`, which builds of the plugin's `main` branch
use; released versions of the plugin use `production`. Builds of other branches use the staging
stack. Promoting moves `production` to the tested version, image and configuration together,
without rebuilding or redeploying anything. Rolling back is promoting the previous version again.

## Prerequisites

- The AWS CLI with credentials for the stack's account. The first deploy creates IAM roles and a
  Cognito identity pool, so it needs IAM and Cognito permissions as well as CloudFormation, ECR and
  AgentCore.
- Docker with ARM64 builds (AgentCore runs ARM64 containers).
- In each account, an ECR repo named `davai-agentcore-backend` (with immutable tags) and three
  Secrets Manager secrets holding the provider keys: `davai-agentcore/openai-api-key`,
  `davai-agentcore/anthropic-api-key` and `davai-agentcore/google-api-key`. The value can be the
  key itself or JSON such as `{"key": "..."}`. These live outside the stacks, so deleting a stack
  doesn't delete them.

## Deploy a backend image

Each deploy needs a new image tag. The runtime only changes when the image URI changes, and the
repos reject a tag that is already in use.

```bash
ENVIRONMENT=production   # or staging
REGISTRY=612297603577.dkr.ecr.us-east-1.amazonaws.com   # 816253370536... for staging
TAG=$(date +%Y%m%d)-$(git rev-parse --short HEAD)

# 1. Build the image from backend/
docker build --platform linux/arm64 -t "davai-agentcore-backend:$TAG" backend

# 2. Push it to the account's ECR repo (for staging, add --profile with your QA-account
#    profile, such as agentcore)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "$REGISTRY"
docker tag "davai-agentcore-backend:$TAG" "$REGISTRY/davai-agentcore-backend:$TAG"
docker push "$REGISTRY/davai-agentcore-backend:$TAG"

# 3. Point the stack's runtime at the new image. This ends by printing ./infra/status.sh,
#    where the DEFAULT endpoint shows the new version.
./infra/deploy.sh "$ENVIRONMENT" "$REGISTRY/davai-agentcore-backend:$TAG"

# 4. Run one anonymous turn through Cognito and the WebSocket, on the DEFAULT endpoint
node scripts/agentcore-cognito-smoke.mjs --stack "davai-agentcore-$ENVIRONMENT"
```

`./infra/status.sh <staging|production>` shows what each endpoint is running at any time: its
runtime version and that version's image. Image tags carry the commit's short SHA, so this leads
back to the code. [DEPLOYED.md](DEPLOYED.md) only changes when a stack is created or recreated.

The staging stack is shared: deploying a branch's backend there replaces what everyone else is
testing against.

## Promote a version to production

After a version has been tested on the production stack's `DEFAULT` endpoint:

```bash
./infra/promote.sh <runtime-version>
node scripts/agentcore-cognito-smoke.mjs --stack davai-agentcore-production --qualifier production
```

`promote.sh` changes only the `production` endpoint. It reuses the stack's current template and
parameters. The first promotion creates the `production` endpoint.

## Creating a stack

`deploy.sh` creates the stack if it doesn't exist. Create the ECR repo and the three secrets first.

The client has each stack's outputs (identity pool ID, unauthenticated role ARN and runtime ARN)
written into `src/utils/agentcore-config.ts`. The runtime ARN ends in a random suffix, so creating
or recreating a stack means updating that file and rebuilding the client.
