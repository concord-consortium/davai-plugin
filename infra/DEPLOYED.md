# Deployed — AgentCore stacks

The staging stack (QA account) comes first; the production stack (main account) is
[further down](#production-stack-main-account).

This file records what changes only when a stack is created or recreated. Which runtime version
and image each endpoint serves changes with every deploy and promotion, so it isn't kept here. To
see it, run:
```bash
./infra/status.sh staging      # or production
```

## Staging stack (QA account)

**Source of truth: the `davai-agentcore-staging` CloudFormation stack** (template:
[cloudformation.yml](cloudformation.yml)), account 816253370536, us-east-1, managed with the
AWS CLI (profile `agentcore`). The earlier hand-rolled resources (runtime
`davai_agentcore-0c9quSDd49`, role `davai-agentcore-runtime-execution`) were **deleted
2026-08-07** and replaced by this stack.

### Stack resources
| resource | value |
|---|---|
| AgentCore runtime | `davai_agentcore_staging-guJgof856F` |
| Runtime ARN | `arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore_staging-guJgof856F` |
| Execution role | `davai-agentcore-staging-execution` |
| Cognito Identity Pool | `us-east-1:f9ef35df-041f-4731-813f-67e998dbc98f` (unauthenticated, **classic flow**) |
| Unauth role | `davai-agentcore-staging-unauth` — may ONLY `InvokeAgentRuntime` / `InvokeAgentRuntimeWithWebSocketStream` on this runtime |
| WebSocket endpoint | `wss://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/<url-encoded runtime ARN>/ws` |

ECR repo `davai-agentcore-backend` predates the stack and is referenced via the `ImageUri`
parameter. The secrets `davai-agentcore/{openai,anthropic,google}-api-key` are outside the stack.
They were created on 2026-11-23 from the keys the stack already had, so the keys didn't change.

### Deploy / update
```bash
./infra/deploy.sh staging <image-uri>
```
See [README.md](README.md). The live stack was created when the template took the provider keys
as NoEcho parameters, and it still passes them to the runtime that way. The next deploy switches it
to the secrets above, with no other step needed.

### Public browser access path (verified live 2026-08-07)
Anonymous client → Cognito `GetId` + `GetOpenIdToken` → `sts:AssumeRoleWithWebIdentity`
(classic flow — the enhanced flow's service allowlist excludes bedrock-agentcore) → SigV4
presigned URL (canonical path double-encoded, empty-string payload hash) → WebSocket → runtime
`/ws` → streaming token frames. Repro, and the client transport's reference implementation:
```bash
node scripts/agentcore-cognito-smoke.mjs
```

### Teardown
```bash
aws cloudformation delete-stack --profile agentcore --region us-east-1 --stack-name davai-agentcore-staging
# ECR repo (outside the stack): aws ecr delete-repository --repository-name davai-agentcore-backend --force
```

## Production stack (main account)

**Source of truth: the `davai-agentcore-production` CloudFormation stack**, account 612297603577,
us-east-1, managed with the AWS CLI (default profile). Created 2026-11-17. Released versions of
the plugin use its `production` endpoint, and builds of `main` use its `DEFAULT` endpoint
(`src/utils/agentcore-config.ts`).

| resource | value |
|---|---|
| AgentCore runtime | `davai_agentcore_production-TFK1Yl3Aea` |
| Runtime ARN | `arn:aws:bedrock-agentcore:us-east-1:612297603577:runtime/davai_agentcore_production-TFK1Yl3Aea` |
| Endpoints | `DEFAULT` (release candidates) and `production` (releases) |
| Execution role | `davai-agentcore-production-execution` |
| Cognito Identity Pool | `us-east-1:a5e4cbee-dfc7-4a29-b3d6-c8f52fa07b7e` (unauthenticated, classic flow) |
| Unauth role | `arn:aws:iam::612297603577:role/davai-agentcore-production-unauth` |

ECR repo `davai-agentcore-backend` (immutable tags) and the secrets
`davai-agentcore/{openai,anthropic,google}-api-key` are outside the stack. The secrets were copied
from the SAM server's `prod-*-api-key` secrets, so both backends use the same keys.

Deploy with `./infra/deploy.sh production <image-uri>`, promote with `./infra/promote.sh <version>`
(see [README.md](README.md)). Check both endpoints with:
```bash
node scripts/agentcore-cognito-smoke.mjs --stack davai-agentcore-production
node scripts/agentcore-cognito-smoke.mjs --stack davai-agentcore-production --qualifier production
```

Teardown (the ECR repo and secrets are separate):
```bash
aws cloudformation delete-stack --region us-east-1 --stack-name davai-agentcore-production
```

## Production-hardening follow-ups (from the 2026-08-07 code review)
Deliberately deferred to the production-stack work:
- Per-identity throttling/quotas (WAF or Cognito-keyed) on top of the anonymous access model —
  note the legacy SAM setup has the same exposure class (its AUTH_TOKEN ships in the public bundle).
