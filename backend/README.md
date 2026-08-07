# backend/ — AgentCore BYO container

The new backend: the existing **LangGraph-JS** agent re-hosted in an AgentCore bring-your-own container.

## What's here (P2)
- `src/agent/` — the agent, **ported verbatim** from `reference/sam-server/src/` (multi-provider routing
  OpenAI/Anthropic/Google, history trimming, tools, and the tool-repair logic). The **only** change is
  the checkpointer: `PostgresSaver` → in-VM **`MemorySaver`** (`src/agent/utils/llm-utils.ts`).
- `src/runner.ts` — one-turn orchestration distilled from the old `job-processor.ts` (tool-repair
  self-heal, streaming accumulation, identical output shape) with **no** jobs table / SQS / pg LISTEN.
- `src/server.ts` — the AgentCore service contract: `GET /ping` + `POST /invocations` on **port 8080**.
  (`/ws` WebSocket + SSE streaming land in P3; P2 returns the final turn result synchronously.)
- `Dockerfile` — two-stage **ARM64** image (AgentCore requirement), ~325 MB.

## Build & run locally
```bash
npm install
npm run typecheck        # clean
npm run build            # esbuild bundle -> dist/server.cjs
PORT=8763 npm start      # or: npm run dev  (tsx watch)
curl localhost:8763/ping # {"status":"Healthy"}

# as the actual ARM64 container:
docker build --platform linux/arm64 -t davai-agentcore-backend:p2 .
docker run --rm -p 8080:8080 --env-file .env davai-agentcore-backend:p2
```

`POST /invocations` body (mirrors the old job input; `threadId` == AgentCore `runtimeSessionId`):
```jsonc
// message turn
{"llmId":"{\"id\":\"gpt-4o\",\"provider\":\"OpenAI\"}","threadId":"<>=33 chars>","message":"...","dataContexts":[],"graphs":[]}
// tool result turn
{"kind":"tool","llmId":"...","threadId":"...","message":{"tool_call_id":"...","content":"..."}}
```
Returns the client-facing output unchanged: `{response}` or a `requires_action` tool-call payload.

## Verified (P2)
- ✅ typecheck clean; esbuild build; ARM64 image builds (325 MB) and runs; `/ping` 200 in-container.
- ✅ `/invocations` runs the full LangGraph pipeline end-to-end **up to the provider call** (validation,
  tool-repair, streaming, response shaping all execute; stops only at the missing key).
- ⏳ **Live agent parity** (a real LLM turn vs the old backend) needs a **provider API key** — see
  `env.example`. Same access class as the AWS creds; not yet wired for this repo.

Copy `env.example` → `.env` and set at least one `*_API_KEY` to run a live turn.
