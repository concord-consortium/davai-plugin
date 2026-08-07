# Design

Companion to [`GOAL.md`](GOAL.md). Decisions here were settled during P0 scoping; research backing them
is in [`research/`](research/).

## Architecture at a glance

```
CODAP  ──di=──▶  DAVAI client (forked)  ──WebSocket──▶  AgentCore microVM (per threadId)
                   • WS transport replaces 500ms/1s poll        • LangGraph-JS agent (unchanged logic)
                   • answers mid-turn CODAP tool calls          • in-VM checkpointer (no Postgres)
                     over the same open socket                  • streams tokens; pauses for client tools
                   • re-seeds from transcript on idle-out       • direct-to-provider LLM calls
        ✗ gone: SQS · jobs table · RDS Postgres · status-poll endpoint
```

## Component design

### backend/ — AgentCore BYO container
- **Runtime contract:** HTTP server on **port 8080** exposing `POST /invocations` + `GET /ping`
  (health), plus a **`/ws`** WebSocket endpoint (AgentCore `InvokeAgentRuntimeWithWebSocketStream`).
  **ARM64** image ≤2 GB.
- **Agent:** the existing **LangGraph-JS** graph ported from `reference/sam-server/src/utils/llm-utils.ts`
  + `tool-utils.ts` — multi-provider routing (OpenAI/Anthropic/Google), history trimming, and the
  tool-repair logic, all preserved.
- **State:** `PostgresSaver` → an **in-VM checkpointer** (LangGraph `MemorySaver`, or a local-disk saver
  on the microVM's 1 GB ephemeral disk). No serialization to any shared store.
- **Session:** the container relies on AgentCore routing `runtimeSessionId` → the same microVM, so a
  conversation's checkpointer state simply lives in that VM for the session's life.
- **LLM calls stay direct-to-provider** (not through Bedrock) — matches "same langchain setup," and means
  the execution role does **not** need `bedrock:InvokeModel`.

### client/ — forked DAVAI plugin
- Replace the `postMessage`/poll loop (`assistant-model.ts`, `llm-utils.ts`) with a **WebSocket transport**:
  open a socket keyed by `runtimeSessionId` (derived from the existing `threadId`, padded to ≥33 chars);
  stream assistant tokens; on a **mid-turn tool call**, run the CODAP op via
  `codapInterface.sendRequest` and **return the result over the same socket** (no second job, no re-poll).
- **Idle re-seed:** on reconnect after a microVM idle-out, replay recent history from `ChatTranscriptModel`
  to rebuild agent context. Zero server persistence.
- Keep the shared-bearer-secret auth (adapt only as AgentCore inbound auth requires).

### infra/ — IaC (dev account)
- Provision: ECR repo, the AgentCore **runtime execution role**, and the **AgentCore Runtime + endpoint**
  pointing at the pushed image. Prefer the **AgentCore starter toolkit** (`agentcore configure/launch`,
  CodeBuild builds — no local Docker) unless we choose CDK/SAM.
- Reuse existing dev-account Secrets Manager entries for provider API keys.

### done-loop/ — parity + latency harness
- **Driver:** Playwright (from `harness/`, lifted from `codap-plugin-starter-project`). Loads the forked
  client in real CODAP via `di=`, drives interactions, reads document state back via
  `@concord-consortium/codap-plugin-api` (`get*`) / the CODAP API Tester.
- **Interaction suite:** ~8–12 fixed interactions across two classes:
  - **modify** ("make a scatterplot of X vs Y", "select cases where…", "add attribute…") →
    assert on **document-state deltas** (deterministic).
  - **describe** ("summarize this dataset", "what are the attributes?") → **LLM-judge** semantic
    equivalence vs the old backend.
- **Latency:** reuse the client's `performance.now()` hooks; ≥20 runs/interaction against old (deployed,
  polling) and new (AgentCore, WS) stacks; report mean/p50/p95 + removed-component breakdown.

## Access (open P0 item)

Not yet available on this machine — needed before P1 baseline measurement and P4 deploy:
- **Toolchain:** AWS CLI, and either Docker+ARM64 buildx **or** the AgentCore starter toolkit; `gh` (or a
  GitHub token) to publish the repo. (`git`, `node` present.)
- **AWS (scoped role, davai dev account):** `bedrock-agentcore:CreateAgentRuntime/…Endpoint/InvokeAgentRuntime`;
  ECR create/push/pull; `iam:PassRole` (+ create the runtime execution role); CloudWatch Logs (+X-Ray);
  Secrets Manager `GetSecretValue` on the provider-key secrets; read on the existing `sam-server` stack
  (to identify the deployed baseline). **Not needed:** `bedrock:InvokeModel` (LLM calls stay direct-to-provider).

Per the charter's tripwire, if AWS access blocks progress beyond a short spike we stop and surface it —
but P0–P3 (scaffold, client fork, container build, in-VM checkpointer, local parity, WS transport,
interaction suite) proceed without it.
