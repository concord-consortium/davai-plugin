# Deployed — QA latency experiment

Live deployment of the new AgentCore stack. **Shared QA account — all resources are namespaced
`davai-agentcore*` and tagged `Project=davai-agentcore, Purpose=qa-latency-experiment, Owner=cdorsey-qa`.
Nothing else in the account was touched.**

## Resources created (account 816253370536, us-east-1)
| resource | name / id |
|---|---|
| ECR repo | `davai-agentcore-backend` (`816253370536.dkr.ecr.us-east-1.amazonaws.com/davai-agentcore-backend:latest`) |
| IAM execution role | `davai-agentcore-runtime-execution` (ECR pull + CW Logs + X-Ray; **no** `bedrock:InvokeModel`, **no** Secrets Manager) |
| AgentCore runtime | `davai_agentcore-0c9quSDd49` — ARN `arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore-0c9quSDd49` |
| CloudWatch logs | `/aws/bedrock-agentcore/...` (auto) |

Network: `PUBLIC`. Protocol: `HTTP`. OpenAI key: **runtime env var** (no Secrets Manager resource).
Image built locally (Docker ARM64) — **no CodeBuild** project created.

## Verified live (through AgentCore `invoke-agent-runtime`, real OpenAI gpt-4o-mini)
- Plain turn → `{"response":"pong"}` (HTTP 200).
- **Multi-turn memory**: turn 1 "remember 7" → turn 2 (same `runtimeSessionId`) → `{"response":"7"}` —
  in-VM state persists on the deployed microVM, **no Postgres**. (metrics #3, #4, #5)
- **Tool-calling**: "make a scatterplot…" → `status:"requires_action"` real `create_request`. (metric #1 direction)

## Invoke (repro)
```bash
ARN=arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore-0c9quSDd49
printf '%s' '{"llmId":"{\"id\":\"gpt-4o-mini\",\"provider\":\"OpenAI\"}","threadId":"t-000000000000000000000000000000000","message":"Reply: pong"}' > /tmp/p.json
aws bedrock-agentcore invoke-agent-runtime --region us-east-1 --agent-runtime-arn "$ARN" \
  --runtime-session-id "sess-0000000000000000000000000000000000" --content-type application/json \
  --payload fileb:///tmp/p.json /tmp/out.json && cat /tmp/out.json
```

## Teardown (leaves nothing behind)
```bash
aws bedrock-agentcore-control delete-agent-runtime --region us-east-1 --agent-runtime-id davai_agentcore-0c9quSDd49
aws ecr delete-repository --region us-east-1 --repository-name davai-agentcore-backend --force
aws iam delete-role-policy --role-name davai-agentcore-runtime-execution --policy-name execution
aws iam delete-role --role-name davai-agentcore-runtime-execution
# CloudWatch log group (if desired):
aws logs delete-log-group --region us-east-1 --log-group-name /aws/bedrock-agentcore/runtimes/davai_agentcore-0c9quSDd49-DEFAULT 2>/dev/null || true
```
