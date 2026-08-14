# Davai Plugin Server - AgentCore container

The DAVAI server, running as a Bedrock AgentCore bring-your-own container. Previously
this was an AWS SAM application (API Gateway + five Lambdas + RDS PostgreSQL + SQS);
all of that is gone. The agent code is unchanged — only the transport and the job
storage moved.

## Prerequisites

1. Install Node.js dependencies: `npm install` (from inside ./sam-server)
2. Copy `env.example` to `.env` and fill in the provider keys you need

## Quick Start

```bash
npm run typecheck        # tsc --noEmit
npm run build            # esbuild bundle -> dist/agentcore-server.cjs
PORT=8763 npm start
curl localhost:8763/ping # {"status":"Healthy"}
```

As the actual ARM64 container (AgentCore requires ARM64):

```bash
docker build --platform linux/arm64 -t davai-server .
docker run --rm -p 8080:8080 --env-file .env davai-server
```

### Smoke test

Exercises the full submit -> background run -> poll -> cancel path against a running
server. It does not need provider keys (turns terminate at the missing-key error,
which still proves the transport works).

```bash
ENVIRONMENT=local DAVAI_API_SECRET=smoke PORT=8763 npm start
DAVAI_API_SECRET=smoke npm run test:smoke
```

## Service contract

AgentCore requires exactly two routes on port 8080:

- **`GET /ping`** — health check
- **`POST /invocations`** — one invocation

The four routes API Gateway used to expose are selected by an `action` field on the
invocation payload. Responses are byte-identical to what API Gateway returned:

| Old route | Invocation payload |
|---|---|
| `POST /default/davaiServer/message` | `{"action":"message", llmId, message, threadId, dataContexts?, graphs?, effort?}` |
| `POST /default/davaiServer/tool` | `{"action":"tool", llmId, message, threadId, effort?}` |
| `GET /default/davaiServer/status?messageId=X` | `{"action":"status", messageId}` |
| `POST /default/davaiServer/cancel` | `{"action":"cancel", messageId}` |

Mapping the client's four HTTP paths onto that one endpoint is the caller's job — it
has to sign requests with SigV4 anyway — which is why the client is unchanged.

## Architecture

- **`src/agentcore/server.ts`** — the service contract. Synthesizes the
  `APIGatewayProxyEvent` each handler already expects and returns its
  `APIGatewayProxyResult` verbatim.
- **`src/agentcore/job-store.ts`** — in-process replacement for the `jobs` table, the
  SQS queue, and the `LISTEN/NOTIFY job_cancelled` channel. Those three existed only
  to pass state between Lambdas that could not see each other; in one container they
  can. The SQL write guards are preserved so a late completion cannot clobber a cancel.
- **`src/handlers/`** — unchanged in shape: `message` and `tool` create a job and return
  202, `job-processor` runs the turn in the background, `status` serves the poll, and
  `cancel` aborts an in-flight turn.
- **`src/utils/llm-utils.ts`** — the LangGraph app, checkpointed with an in-VM
  `MemorySaver` (was `PostgresSaver`).

**This rests on session affinity.** AgentCore pins every request carrying the same
`runtimeSessionId` to the same microVM, so a turn's submit, polls, and cancel all reach
the process holding its state. A poll that arrives without the matching session id will
land on a different microVM and 404.

Deployment (ECR push, AgentCore runtime configuration, IAM) is not defined in this
branch — no infrastructure-as-code is included yet.

## Job Cancellation

1. The client sends `{"action":"cancel", messageId}`.
2. `cancel.ts` calls `requestCancel()`, which marks the job cancelled and calls
   `AbortController.abort()` on the in-flight turn directly.
3. The LangGraph workflow stops; the job store records `cancelled`, guarded so a
   late completion cannot overwrite it.
4. The client's next poll sees `cancelled`.

Previously steps 2-3 crossed a process boundary: the cancel handler updated the jobs
table, a PostgreSQL trigger fired `pg_notify('job_cancelled')`, and the job-processor
Lambda picked it up over a persistent `LISTEN` connection. Same behavior, one process.

## LLM Instructions

The instructions text for the LLM prompt are in ./sam-server/src/text/instructions.ts. These are added to the `promptTemplate` defined in ./sam-server/src/utils/llm-utils.ts along with the CODAP API documentation defined in ./sam-server/src/text/codap-api-documentation.ts.

## LLM Providers

The code currently supports three LLM providers: Anthropic, Google and OpenAI. To add another provider, update the `createModelInstance` function in ./sam-server/utils/llm-utils.ts. Follow the pattern used for Google and OpenAI. You will also need to add a new environment variable for the associated API key. And finally, you will need to update the `llmList` in the client app's app-config.json file.

## Tool Functions

Tool functions are defined in ./sam-server/src/utils/tool-utils.ts. There are currently two tool functions:

- createRequestTool - Used for making CODAP API requests
- sonifyGraphTool - Used for selecting a graph for sonification

To add a new tool function, define it in tool-utils.ts and add then it to the `tools` array in the same file. You will also need to update the `processToolCall` action in the client app's `AssistantModel` to handle the tool call.
