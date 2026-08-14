# backend/ — DAVAI on AgentCore

The DAVAI server, running as a Bedrock AgentCore bring-your-own container. Previously
this was an AWS SAM application (API Gateway + five Lambdas + RDS PostgreSQL + SQS);
all of that is gone, along with the job/queue/poll envelope it existed to support. The
agent itself — providers, prompt, tools, history trimming — is unchanged and still
lives in `src/utils/` and `src/text/`.

## Prerequisites

1. Install Node.js dependencies: `npm install` (from inside ./backend)
2. Copy `env.example` to `.env` and fill in the provider keys you need

## Quick Start

```bash
npm run typecheck        # tsc --noEmit
npm run build            # esbuild bundle -> dist/server.cjs
PORT=8763 npm start
curl localhost:8763/ping # {"status":"Healthy"}
```

As the actual ARM64 container (AgentCore requires ARM64):

```bash
docker build --platform linux/arm64 -t davai-backend .
docker run --rm -p 8080:8080 --env-file .env davai-backend
```

### Tests

```bash
npm test          # jest unit tests for the agent utils
npm run test:ws   # WebSocket transport smoke test (no provider key needed)
npm run test:ws:live   # same, against a real provider
```

`test:ws` runs against `DAVAI_FAKE_AGENT=1` (see `src/fake-agent.ts`), a scripted agent
that exercises the streaming and tool round-trip protocol without an API key.

## Service contract

AgentCore requires `GET /ping` and `POST /invocations` on port 8080; the container also
mounts a `/ws` WebSocket endpoint.

- **`GET /ping`** — health check
- **`POST /invocations`** — run one turn. Returns the output as JSON, or streams SSE
  when the caller sends `Accept: text/event-stream`.
- **`/ws`** — one turn per inbound frame, streaming `{type:"token"}` frames and ending
  with `{type:"result", output}`.

A turn input is `{llmId, threadId, message, dataContexts?, graphs?, effort?}`, or
`{kind:"tool", llmId, threadId, message:{content, tool_call_id}, effort?}`. `threadId`
doubles as the AgentCore `runtimeSessionId`.

The WebSocket is the one that matters for latency: when a turn returns a
`requires_action` tool call, the client runs the CODAP operation and sends the result
back over the **same socket** — no second queued job and no new poll cycle.

## Architecture

- **`src/server.ts`** — the AgentCore service contract (`/ping`, `/invocations`, SSE).
- **`src/ws.ts`** — the WebSocket transport, including thread re-seeding after a
  microVM idles out.
- **`src/runner.ts`** — one-turn orchestration: tool-repair self-heal, streaming
  accumulation, and the response shape, all preserved from the old job-processor.
- **`src/validate.ts`** — turn-input validation shared by both transports.
- **`src/utils/llm-utils.ts`** — the LangGraph app, checkpointed with an in-VM
  `MemorySaver` (was `PostgresSaver`).

**This rests on session affinity.** AgentCore pins every request carrying the same
`runtimeSessionId` to the same microVM, so a thread's turns reach the process holding
its conversation state.

Deployment (ECR push, AgentCore runtime configuration, IAM, anonymous access) is not in
this branch — see PR #117, which adds the CloudFormation stack and Cognito setup.

## Auth

`src/server.ts` and `src/ws.ts` check an optional shared bearer token in
`DAVAI_API_SECRET`; when it is unset, the endpoints are open. This replaced the old
`auth-utils.ts`, which resolved a Secrets Manager ARN in production — see PR #117 for
where public access is handled now.

## LLM Instructions

The instructions text for the LLM prompt are in ./backend/src/text/instructions.ts. These are added to the `promptTemplate` defined in ./backend/src/utils/llm-utils.ts along with the CODAP API documentation defined in ./backend/src/text/codap-api-documentation.ts.

## LLM Providers

The code currently supports three LLM providers: Anthropic, Google and OpenAI. To add another provider, update the `createModelInstance` function in ./backend/src/utils/llm-utils.ts. Follow the pattern used for Google and OpenAI. You will also need to add a new environment variable for the associated API key. And finally, you will need to update the `llmList` in the client app's app-config.json file.

## Tool Functions

Tool functions are defined in ./backend/src/utils/tool-utils.ts. There are currently two tool functions:

- createRequestTool - Used for making CODAP API requests
- sonifyGraphTool - Used for selecting a graph for sonification

To add a new tool function, define it in tool-utils.ts and add then it to the `tools` array in the same file. You will also need to update the `processToolCall` action in the client app's `AssistantModel` to handle the tool call.
