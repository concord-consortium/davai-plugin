# infra/ — the AgentCore staging stack

[cloudformation.yml](cloudformation.yml) defines the stack: the AgentCore runtime that runs the
`backend/` container image, the runtime's execution role, and a Cognito identity pool whose
unauthenticated role may invoke only that runtime. The stack is managed with the AWS CLI. CI does
not deploy it.

[DEPLOYED.md](DEPLOYED.md) records the live staging stack (account, runtime ARN, identity pool, the
image it is running) and how to tear it down.

## Prerequisites

- The AWS CLI with a profile named `agentcore` for the QA account (816253370536), with permission to
  push to ECR and to deploy the stack. The stack creates IAM roles and a Cognito identity pool, so
  the profile needs IAM and Cognito permissions as well as CloudFormation and AgentCore.
- Docker with ARM64 builds (AgentCore runs ARM64 containers).
- `backend/.env` holding `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and `GOOGLE_API_KEY`. The deploy
  script passes all three to the stack; a key that is missing from the file is set to empty, which
  turns that provider off.

## Deploy a backend change

Each deploy needs a new image tag. The runtime only changes when the image URI changes, so
re-pushing an existing tag (such as `latest`) and deploying it does nothing.

```bash
REGISTRY=816253370536.dkr.ecr.us-east-1.amazonaws.com
TAG=<name>-<yyyymmdd>    # e.g. usage-20260824

# 1. Build the image from backend/
docker build --platform linux/arm64 -t "davai-agentcore-backend:$TAG" backend

# 2. Push it to the stack's ECR repo
aws ecr get-login-password --profile agentcore --region us-east-1 \
  | docker login --username AWS --password-stdin "$REGISTRY"
docker tag "davai-agentcore-backend:$TAG" "$REGISTRY/davai-agentcore-backend:$TAG"
docker push "$REGISTRY/davai-agentcore-backend:$TAG"

# 3. Point the stack's runtime at the new image
./infra/deploy-staging.sh "$REGISTRY/davai-agentcore-backend:$TAG"

# 4. Run one anonymous turn through Cognito and the WebSocket
node scripts/agentcore-cognito-smoke.mjs
```

Then update the image tag in [DEPLOYED.md](DEPLOYED.md).

There is one staging stack, and every client build uses it until a production stack exists.
Deploying a branch's backend replaces what everyone else is testing against.

## First-time setup

The ECR repo `davai-agentcore-backend` is not part of the stack. For a new account, create it with
`aws ecr create-repository --repository-name davai-agentcore-backend` before pushing the first image.

The client has the stack's outputs (identity pool ID, unauthenticated role ARN and runtime ARN)
written into `src/utils/agentcore-config.ts`. The runtime ARN ends in a random suffix, so creating
or recreating a stack means updating that file and rebuilding the client.
