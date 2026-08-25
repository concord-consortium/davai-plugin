# Deployed — AgentCore staging stack (QA account)

**Source of truth: the `davai-agentcore-staging` CloudFormation stack** (template:
[cloudformation.yml](cloudformation.yml)), account 816253370536, us-east-1, managed with the
AWS CLI (profile `agentcore`). The earlier hand-rolled resources (runtime
`davai_agentcore-0c9quSDd49`, role `davai-agentcore-runtime-execution`) were **deleted
2026-08-07** and replaced by this stack. The production stack (separate account) is not yet
created; the template is parameterized for it (`EnvironmentName=production`).

## Stack resources
| resource | value |
|---|---|
| AgentCore runtime | `davai_agentcore_staging-guJgof856F` (image `davai-agentcore-backend:usage-20260824`) |
| Runtime ARN | `arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F` |
| Execution role | `davai-agentcore-staging-execution` |
| Cognito Identity Pool | `us-east-1:f9ef35df-041f-4731-813f-67e998dbc98f` (unauthenticated, **classic flow**) |
| Unauth role | `davai-agentcore-staging-unauth` — may ONLY `InvokeAgentRuntime` / `InvokeAgentRuntimeWithWebSocketStream` on this runtime |
| WebSocket endpoint | `wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/<url-encoded runtime ARN>/ws` |

ECR repo `davai-agentcore-backend` predates the stack and is referenced via the `ImageUri`
parameter (images: `usage-20260824` = current, earlier tags = prior).
Provider keys (OpenAI/Anthropic/Google) are runtime env vars fed from NoEcho stack parameters.

## Deploy / update
```bash
./infra/deploy-staging.sh [image-uri]     # reads provider keys from backend/.env
```
(or `aws cloudformation deploy|update-stack` with the same parameters; use
`UsePreviousValue=true` to update without re-supplying keys).

## Public browser access path (verified live 2026-08-07)
Anonymous client → Cognito `GetId` + `GetOpenIdToken` → `sts:AssumeRoleWithWebIdentity`
(classic flow — the enhanced flow's service allowlist excludes bedrock-agentcore) → SigV4
presigned URL (canonical path double-encoded, empty-string payload hash) → WebSocket → runtime
`/ws` → streaming token frames. Repro, and the client transport's reference implementation:
```bash
node scripts/agentcore-cognito-smoke.mjs
```

## Teardown
```bash
aws cloudformation delete-stack --profile agentcore --region us-east-1 --stack-name davai-agentcore-staging
# ECR repo (outside the stack): aws ecr delete-repository --repository-name davai-agentcore-backend --force
```

## Production-hardening follow-ups (from the 2026-08-07 code review)
Deliberately deferred to the production-stack work:
- Per-identity throttling/quotas (WAF or Cognito-keyed) on top of the anonymous access model —
  note the legacy SAM setup has the same exposure class (its AUTH_TOKEN ships in the public bundle).
- Move provider keys from stack parameters to Secrets Manager ARNs (backend already resolves ARNs).
- Turn the release-build staging fallback in src/utils/agentcore-config.ts from a console
  warning into a build failure once the production stack exists.
