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

Network: `PUBLIC`. Protocol: `HTTP`. Provider keys: **runtime env vars** (no Secrets Manager resource).
Image built locally (Docker ARM64) — **no CodeBuild** project created.

## Runtime version 3 (2026-07-14): all three provider keys
`update-agent-runtime` added `ANTHROPIC_API_KEY` and `GOOGLE_API_KEY` alongside the existing
`OPENAI_API_KEY` (same image, `sse-20260714`). Verified live: gpt-4o-mini, claude-haiku-4-5,
and gemini-3.5-flash each answer through `invoke-agent-runtime`. Note env vars are readable
by anyone in the QA account with `get-agent-runtime` — rotate the keys when this experiment
is torn down.

## Runtime version 2 (2026-07-14): SSE streaming
`update-agent-runtime` moved the runtime to image tag `sse-20260714` (also pushed as `latest`;
the prior image is preserved as tag `pre-sse` for rollback). `/invocations` now streams
**SSE** when invoked with `accept: text/event-stream`: sentence-boundary `{type:"token"}`
events (same `shouldFlush` cadence as the SAM server and the WS transport) followed by a
terminal `{type:"result"}`. Callers that don't request event-stream get the original
synchronous JSON — the repro below is unchanged. Verified live end-to-end: browser client in
CODAP → `scripts/agentcore-bridge.mjs` (SigV4 + SSE relay) → deployed runtime, with the first
sentence rendering ~0.5 s before turn completion.

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
