# infra/ — deploy to the davai dev AWS account

Provisions the new stack: an ECR repo, the AgentCore **runtime execution role**, and the **AgentCore
Runtime + endpoint** pointing at the pushed container image. Reuses existing dev-account Secrets Manager
entries for provider API keys. **No Bedrock model access needed** — the agent calls OpenAI/Anthropic/Google
directly (AgentCore is only the host).

## Prerequisites (not yet installed on the build host — see repo README)
- **AWS CLI** configured for the davai dev account (a role with `policies/deploy-caller-policy.json`).
- Either **Docker + ARM64 buildx** (present) **or** the **AgentCore starter toolkit** (`pip install
  bedrock-agentcore-starter-toolkit`, provides the `agentcore` CLI + CodeBuild builds without local Docker).

## Policies (`policies/`)
Directly applicable IAM documents (replace `ACCOUNT_ID` / `REGION` / secret names first):
- `execution-role-trust-policy.json` — trust for `bedrock-agentcore.amazonaws.com`.
- `execution-role-permissions-policy.json` — least-privilege for the **runtime**: ECR pull, CloudWatch
  Logs, X-Ray, and `secretsmanager:GetSecretValue` on the provider-key secrets. **No `bedrock:InvokeModel`.**
- `deploy-caller-policy.json` — what the **deployer** needs: ECR push, `bedrock-agentcore:Create/Update
  AgentRuntime(+Endpoint)`, and `iam:PassRole` (scoped to the execution role, `PassedToService` =
  bedrock-agentcore).

## Deploy sequence (P4)
```bash
export AWS_REGION=us-east-1 ACCOUNT_ID=<dev-account-id>
export REPO=davai-agentcore-backend ROLE=davai-agentcore-runtime-execution

# 1. Execution role (once)
aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document file://policies/execution-role-trust-policy.json
aws iam put-role-policy --role-name "$ROLE" --policy-name execution \
  --policy-document file://policies/execution-role-permissions-policy.json   # after substituting ACCOUNT_ID/REGION

# 2. ECR repo + push the ARM64 image (built from ../backend)
aws ecr create-repository --repository-name "$REPO" 2>/dev/null || true
aws ecr get-login-password | docker login --username AWS --password-stdin \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
docker build --platform linux/arm64 -t "$REPO:latest" ../backend
docker tag "$REPO:latest" "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"

# 3. Create the AgentCore runtime pointing at the image + execution role.
#    CONFIRM the exact command/params against the installed CLI before running:
#      agentcore --help   (starter toolkit: `agentcore configure` then `agentcore launch`)
#      aws bedrock-agentcore-control help   (raw control-plane: create-agent-runtime)
#    Left un-fabricated here on purpose — the CLI shape is version-specific and neither
#    the aws CLI nor the agentcore toolkit is installed on the build host yet.
```

## Verified now (pre-deploy)
- ✅ All three policy JSONs are valid and directly applicable (`python3 -m json.tool`).
- ✅ The backend image builds ARM64 and runs `/ping` locally (see `../backend`).
- ⏳ Steps 1–3 pend AWS dev-account credentials + CLI install; step 3's exact invocation is confirmed
  against the installed CLI's `--help` rather than guessed.
