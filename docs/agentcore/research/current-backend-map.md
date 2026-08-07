# Current DAVAI backend — architecture & test map

_Captured during P0 from `concord-consortium/davai-plugin` (forked into `client/`, old backend in
`reference/sam-server/`). File citations are relative to the original repo (same paths under `client/`
and `reference/sam-server/`)._

## Key correction to the original premise
The backend uses **PostgreSQL (RDS) + SQS**, **not DynamoDB**. A `jobs` table in Postgres plus a
LangGraph `PostgresSaver` checkpointer hold state. So the shared layer we eliminate is
**RDS Postgres + SQS**.

## 1. Request lifecycle (a chat turn)
1. Client `POST .../davaiServer/message` `{llmId, message, threadId, dataContexts, graphs, effort}`
   (`src/handlers/message.ts`).
2. `message.ts` authorizes, `nanoid()` → `messageId`, INSERTs a `jobs` row (`kind='message'`,
   `status='queued'`, `input` JSONB), sends `{messageId}` to **SQS**, returns **202** `{messageId,"queued"}`.
   The API is fully asynchronous.
3. SQS `LLMJobQueue` triggers `JobProcessorFunction` (`BatchSize:1`).
4. `job-processor.ts` loads the job, builds LangGraph config `{configurable:{llmId, thread_id:threadId,
   effort}, signal}`, compiles the app (`getLangApp()`), streams `streamMode:["messages","values"]`.
5. Partial tokens are written back to the **same jobs row**: `UPDATE jobs SET status='streaming',
   output=$1`; on completion `status='completed', output=<{response}|tool-call payload>`.
6. **Client gets the result by polling** `GET .../status?messageId=...` (`status.ts`) →
   `SELECT status, output FROM jobs`. No push/websocket.

**AWS resources (`template.yaml`):** Lambdas `Message`, `Tool`, `Status`, `Cancel`, `Setup`,
`JobProcessor` (SQS-triggered, `Timeout:300`); API Gateway `DavaiApi` (routes under
`/default/davaiServer/{message,tool,status,cancel,setup}`, CORS `*`); **SQS** `LLMJobQueue`
(`VisibilityTimeout:300`, no DLQ); **RDS Postgres** `db.t3.micro` (private, reusable via `RdsEndpoint`);
Secrets Manager (`davai-api-secret`, `openai/google/anthropic/langsmith-api-key`); VPC + 2 private/1
public subnet + NAT + SGs + optional VPC interface endpoints.

**State storage:** `jobs` table (`message_id PK, kind, status, input JSONB, output JSONB, …`, GIN index
on `input->>'threadId'`). **Conversation history lives in the LangGraph `checkpoints` table** via
`PostgresSaver`, keyed on `thread_id` (`llm-utils.ts`). A PG trigger `notify_job_cancelled` +
`LISTEN job_cancelled` aborts in-flight runs on cancel.

## 2. LangChain usage
LangChain **JS** + **LangGraph** (`@langchain/langgraph` `StateGraph`) with
`@langchain/langgraph-checkpoint-postgres` `PostgresSaver`. Multi-provider: `ChatOpenAI`,
`ChatGoogleGenerativeAI`, `ChatAnthropic`, chosen at runtime from `llmId` `{id, provider}`.
Provider-specific handling: OpenAI reasoning via Responses API + `reasoning.effort`; Anthropic
no-sampling models omit temperature; `outputConfig.effort`. Single-node graph `START→model→END`;
history trimmed via `trimMessages({maxTokens:100000,strategy:"last"})`; system prompt embeds
instructions + CODAP API docs + live `dataContexts`/`graphs`. **Streaming is server-internal only**
(flushed to `jobs.output`, never streamed over HTTP).

## 3. Server-side tool calling — **tools are CLIENT-executed**
Two server tools via LangChain `tool()` (`tool-utils.ts`): `create_request` (emit a CODAP Data
Interactive request) and `sonify_graph`. They **do not execute** — they normalize/echo the LLM's args.
On a tool call, `toolCallResponse` returns `{status:"requires_action", request, tool_call_id, type}` as
the job output. The **client executes CODAP** in `processToolCall` (`assistant-model.ts`) via
`codapInterface.sendRequest(request)`, then POSTs the result to `/tool`, which creates a `kind='tool'`
job that the processor feeds back as a LangChain `ToolMessage`. Substantial **tool-repair** logic
(`buildToolRepairMessages`, `getUnansweredToolCallIds`) synthesizes error `tool_result`s for orphaned
`tool_use`s so Anthropic threads don't break.

**⇒ The tightest constraint:** one turn with tools = client→server→queue→LLM→poll, then a *second*
queued job for the tool result + another poll cycle. Collapsing this over a WebSocket is the main win.

## 4. Client-side polling
`src/models/assistant-model.ts` (via `postMessage` in `src/utils/llm-utils.ts`): after `POST /message`
returns `messageId`, a `while` loop polls `GET status?messageId=...` — **1 s** when idle, **0.5 s** while
`status==="streaming"`. Completion on `status==="completed"`; also handles `cancelled/error`. No-progress
idle budget `idleBudgetMs=60_000`. The same polling loop is duplicated for the tool round-trip
(`sendToolOutputToLlm`, loops while `status==="requires_action"`).

## 5. Auth
`auth-utils.ts`: a **single shared static bearer secret** (env `DAVAI_API_SECRET` locally, else Secrets
Manager). No JWT / per-user identity. Client sends `Authorization: <AUTH_TOKEN>` verbatim (no `Bearer`).
`/status` is **unauthenticated**. **Session handle already exists: `threadId`** (client `nanoid()` at
assistant init, sent on every call = checkpointer key) — maps to AgentCore `runtimeSessionId` (needs
padding to ≥33 chars; nanoid default is 21).

## 6. Client transcript (enables idle re-seed)
Client has `ChatTranscriptModel` (MST) holding the full `messages` array, and already carries timing
instrumentation (`timingDebug` / `performance.now()` / `formatElapsedTime` in `assistant-model.ts`) —
**reuse these hooks for the latency comparison.**

## 7. Config / env
Client `.env.example`: `REACT_APP_OPENAI_API_KEY`, `REACT_APP_OPENAI_BASE_URL`, `AUTH_TOKEN`,
`LANGCHAIN_SERVER_URL`. Server `env.example`: `AWS_REGION`, `POSTGRES_CONNECTION_STRING`,
`DAVAI_API_SECRET`, `OPENAI/GOOGLE/ANTHROPIC_API_KEY` (literal or Secrets Manager ARN), `LANGSMITH_*`,
`ENVIRONMENT`. Model id+provider+effort come **per-request** from the client; only hard-coded model
constant is `MAX_TOKENS=100000`. Available models defined client-side (`src/app-config.json`,
`ai-assistant-settings/`).
