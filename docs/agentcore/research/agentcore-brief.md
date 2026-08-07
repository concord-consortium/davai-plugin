# AWS Bedrock AgentCore — technical brief (for this migration)

_Captured during P0 scoping. Primary source: AWS docs (`docs.aws.amazon.com/bedrock-agentcore`).
Status: AgentCore GA since **Oct 13, 2025**._

### 1. Runtime & isolation
AgentCore Runtime hosts a containerized agent app; AWS manages scaling, sessions, and isolation.
**Each session runs in its own dedicated microVM with isolated CPU, memory, and filesystem.** On
session end the microVM is terminated and memory sanitized (no cross-session contamination).
- **Max session duration:** 8 h (`maxLifetime`). **Idle timeout:** 15 min (`idleRuntimeSessionTimeout`).
  Hitting either terminates the microVM.
- **Hardware:** max **2 vCPU / 8 GB** per session (fixed). **Ephemeral session disk: 1 GB.**
- **Filesystem:** ephemeral; in-memory and on-disk state **persist across requests within the same
  session**, wiped on termination. Docs: do not use for durability — use AgentCore Memory for that.

### 2. Sticky/session routing
Requests carry a **`runtimeSessionId`** (client-supplied; **min 33 chars**; auto-generated if omitted).
AgentCore routes every subsequent `InvokeAgentRuntime` with that ID to the **same microVM**. Reusing an
ID after termination spins up a fresh environment; omitting/varying it forces new microVMs (cold starts).

### 3. Streaming / bidirectional
- **SSE / HTTP response streaming** over `POST /invocations`.
- **WebSocket** via `InvokeAgentRuntimeWithWebSocketStream` (mount `/ws`) — replaces client polling.
- Constraints: synchronous request timeout **15 min**; streaming/WebSocket max **60 min**; streaming
  chunk ≤10 MB; **WebSocket frame ≤64 KB**, ≤250 frames/sec. Longer work → async jobs (≤8 h, status via `/ping`).

### 4. Framework support
**LangChain/LangGraph explicitly supported** (also CrewAI, Strands). Two deploy contracts:
- **AgentCore Python SDK** (`bedrock-agentcore`): `BedrockAgentCoreApp` + `@app.entrypoint` (Python only).
- **Container (bring-your-own):** expose **`POST /invocations`** + **`GET /ping`** on **port 8080**,
  **ARM64** image ≤2 GB. **← this is our path (agent is LangGraph-JS/Node).**
- **Starter Toolkit / `agentcore` CLI:** `agentcore configure` / `launch`; builds via CodeBuild
  (no local Docker needed). `direct_code_deploy` mode also exists (zip, ≤250 MB compressed).

### 5. Components
Runtime, **Memory**, **Gateway**, **Identity**, **Browser** tool, **Code Interpreter**, **Observability**.
For us: **Memory** = managed alternative to the Postgres context store (deferred); **Gateway** = turns
APIs/Lambdas/MCP into agent tools for server-side tool calling (deferred). All optional for this goal.

### 6. Local dev / testing
`agentcore launch --local` / the SDK's `app.run()` runs the **same app on port 8080 locally** that
Runtime runs in production — production parity. For a BYO container, run the image locally on 8080.

### 7. Pricing
Consumption-based, per-second (1 s min): **$0.0895/vCPU-hour + $0.00945/GB-hour** on active CPU + peak
memory. **I/O-wait and idle time are free** if no background work runs — favorable for chat. No Runtime
free tier. Memory/Gateway/etc. billed separately. Initially 9 regions (incl. us-east-1, us-west-2).

### 8. IAM / permissions
- **Runtime execution role** (assumed by `bedrock-agentcore.amazonaws.com`): ECR pull
  (`ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:GetAuthorizationToken`), CloudWatch Logs +
  X-Ray, and Bedrock model invoke **only if** models are called through Bedrock (we call providers
  directly, so this may be unneeded).
- **Deploy-time caller:** `bedrock-agentcore:CreateAgentRuntime`/`...Endpoint`, ECR push, `iam:PassRole`.
- **Invokers:** `bedrock-agentcore:InvokeAgentRuntime` (or SigV4/OAuth inbound auth).
- CLI can auto-create a broad `AmazonBedrockAgentCoreSDKRuntime-*` policy — AWS flags it too broad for prod.

### 9. Gotchas for a chat backend
- **Session-ID discipline is load-bearing** (≥33 chars; lose/rotate it → new cold microVM + lost in-memory context).
- **Ephemeral state:** 8-h max + 15-min idle cap ⇒ the microVM is NOT a durable store. Our answer:
  **client re-seeds from its transcript on reconnect** (no server store). Revisit only if insufficient.
- **Cold-start** on first invoke / after idle-out — has a dedicated latency-minimization guide.
- **ARM64-only** images ≤2 GB; 1 GB session disk; 100 MB payload cap.
- Active-session quotas (order 5,000/2,500), 200 TPS / 25 new-sessions-per-sec — verify under burst.

**Unverified:** Firecracker named only in AWS blog/secondary material (docs say "microVM"); Lambda cost
comparison is directional, not a quoted AWS figure.
