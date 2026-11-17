# backend/ — DAVAI on AgentCore

The DAVAI server as an AWS Bedrock AgentCore bring-your-own container. It runs the same LangGraph-JS
agent as the SAM application in `sam-server/` (providers, prompt, tools, history trimming, tool-repair),
but without the jobs table, SQS queue, RDS Postgres and status polling that the SAM version uses to pass
state between Lambdas.

```
CODAP ──di=──▶ DAVAI client ──WebSocket──▶ AgentCore microVM (one per threadId)
                                             • LangGraph-JS agent
                                             • in-VM checkpointer (MemorySaver)
                                             • streams tokens; pauses for client-run CODAP tools
                                             • calls the LLM providers directly
```

## Prerequisites

1. Install Node.js dependencies: `npm install` (from inside ./backend)
2. Copy `env.example` to `.env` and set the provider keys you need. Each key may be a literal key or a
   Secrets Manager ARN.

## Quick Start

```bash
npm run typecheck        # tsc --noEmit
npm run build            # esbuild bundle -> dist/server.cjs
PORT=8763 npm start      # or: npm run dev  (tsx watch)
curl localhost:8763/ping # {"status":"Healthy"}
```

As the actual container (AgentCore requires ARM64):

```bash
docker build --platform linux/arm64 -t davai-backend .
docker run --rm -p 8080:8080 --env-file .env davai-backend
```

### Tests

```bash
npm run test:ws        # WebSocket transport smoke test (no provider key needed)
npm run test:ws:live   # the same checks against a real OpenAI model (needs OPENAI_API_KEY)
```

`test:ws` runs the server with `DAVAI_FAKE_AGENT=1` (see `src/fake-agent.ts`), a scripted agent that
exercises the streaming and tool round-trip protocol without an API key.

## Service contract

AgentCore requires `GET /ping` and `POST /invocations` on port 8080; the container also mounts a `/ws`
WebSocket endpoint.

- **`GET /ping`** — health check.
- **`POST /invocations`** — run one turn. Returns the output as JSON, or streams SSE when the caller sends
  `Accept: text/event-stream`.
- **`/ws`** — one turn per inbound frame, streaming `{type:"token"}` frames and ending with
  `{type:"result", output}`.

A turn input is `{llmId, threadId, message, dataContexts?, graphs?, effort?}`, or
`{kind:"tool", llmId, threadId, message:{content, tool_call_id}, effort?}`. `threadId` doubles as the
AgentCore `runtimeSessionId`, so it must be at least 33 characters. The output is what the client already
understands: `{response}`, or a `requires_action` tool-call payload.

The WebSocket is the one that matters for latency: when a turn returns a `requires_action` tool call, the
client runs the CODAP operation and sends the result back over the **same socket**, with no second queued
job and no new poll cycle.

## Architecture

- **`src/server.ts`** — the AgentCore service contract (`/ping`, `/invocations`, SSE).
- **`src/ws.ts`** — the WebSocket transport, including frame chunking and re-seeding a thread after its
  microVM idles out.
- **`src/runner.ts`** — one-turn orchestration: tool-repair self-heal, streaming accumulation and the
  response shape, carried over from the SAM job processor.
- **`src/validate.ts`** — turn-input validation shared by both transports.
- **`src/agent/`** — the agent, copied from `sam-server/src/`. The checkpointer is the intended
  difference: `src/agent/utils/llm-utils.ts` uses an in-VM `MemorySaver` where `sam-server` uses
  `PostgresSaver`.

**This rests on session affinity.** AgentCore pins every request carrying the same `runtimeSessionId` to
the same microVM, so a thread's turns reach the process holding its conversation state. That state is
not durable: a microVM ends after 15 minutes idle or 8 hours total. When that happens the client replays
its transcript over `/ws` and the server writes it into the new microVM's checkpointer with no model call.

LLM calls go straight to the providers, not through Bedrock, so the runtime's execution role does not need
`bedrock:InvokeModel`. See [docs/agentcore.md](../docs/agentcore.md) for AgentCore's limits, pricing and
IAM model.

## Auth

`src/server.ts` and `src/ws.ts` check an optional shared bearer token in `DAVAI_API_SECRET`; when it is
unset, the endpoints are open. Calls that reach the container through AgentCore have already been
authorized by AgentCore itself (SigV4 or OAuth inbound auth), so this token is a second, optional layer.

## LLM Instructions

The instructions text for the LLM prompt is in ./src/agent/text/instructions.ts. The system prompt built
in ./src/agent/utils/llm-utils.ts combines it with the CODAP API documentation in
./src/agent/text/codap-api-documentation.ts.

## LLM Providers

The code currently supports three LLM providers: Anthropic, Google and OpenAI. To add another provider,
update the `createModelInstance` function in ./src/agent/utils/llm-utils.ts, following the pattern used
for Google and OpenAI. Add an environment variable for the provider's API key, add the provider to
`ALLOWED_PROVIDERS` in ./src/validate.ts, and update the `llmList` in the client app's app-config.json.

## Tool Functions

Tool functions are defined in ./src/agent/utils/tool-utils.ts. There are currently two:

- createRequestTool - Used for making CODAP API requests
- sonifyGraphTool - Used for selecting a graph for sonification

To add a new tool function, define it in tool-utils.ts and add it to the `tools` array in the same file.
You will also need to update the `processToolCall` action in the client app's `AssistantModel` to handle
the tool call.
