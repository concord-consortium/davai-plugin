# DAVAI on AgentCore — Project Goal

> This is the project charter. It is the exact `/goal` statement this repo is executing against.
> Completion is defined by the metrics below; the boundary and exit conditions govern scope.

## Goal

Re-host the DAVAI backend on AWS Bedrock AgentCore so that each conversation runs in its own
session-pinned microVM holding context in memory (no SQS, no RDS Postgres, no job table), and
replace the client's poll-based transport with a WebSocket — cutting end-to-end latency while
preserving the existing LangGraph-JS agent behavior. Deliver it as a self-contained repo
(forked client + backend container + IaC + a Playwright done-loop) that proves parity and a
measured latency win against the current deployed stack.

## Phased spine

- **P0 — Scaffold:** fresh repo; fork the client; lift the `codap-plugin-starter-project`
  Playwright harness; verify AWS dev-account access + toolchain (AWS CLI / AgentCore starter toolkit).
- **P1 — Baseline:** confirm the deployed current stack; build a fixed interaction suite
  (modify + describe); instrument and measure old-stack per-turn latency.
- **P2 — Backend container:** LangGraph-JS agent re-hosted in an AgentCore BYO container;
  `PostgresSaver` → in-VM checkpointer; `/invocations` + `/ping`; local-run parity. Validate
  agent parity behind a temporary HTTP path before touching transport.
- **P3 — WebSocket:** `/ws` server contract + forked-client WS transport replacing the poll loop;
  mid-turn CODAP tool round-trips over the socket; `threadId`→`runtimeSessionId` (≥33 chars);
  client re-seed on idle-out.
- **P4 — Deploy + prove:** deploy to the davai dev account; run the done-loop (tiered parity +
  latency comparison); iterate to hit the bar.
- **P5 — Report + reconcile plan** back to `davai-plugin`.

## Completion metrics (all must hold)

1. **Parity (non-inferior to old):** modify-interactions reach the correct CODAP document-state
   outcome in ≥90% of runs and ≥ the old stack's rate; describe-interactions rated semantically
   equivalent to the old backend by an LLM-judge in ≥90% of runs.
2. **Latency:** p50 per-turn end-to-end reduced ≥40% overall and ≥50% on tool-calling
   interactions, over ≥20 runs/interaction vs the deployed baseline; report mean/p50/p95 with a
   removed-component breakdown.
3. **Architecture:** SQS, the jobs table, and RDS Postgres are absent from the new stack; the
   default path has no server-side persistence and no status-poll in the hot path.
4. **Dev parity:** the same container runs locally and in AgentCore via one documented command.
5. **Deployed & green:** new stack live in the dev account; Playwright done-loop runnable and passing.

## Boundary criteria

**In:** the AgentCore container + in-VM state; the WebSocket transport (server + forked client)
incl. the tool round-trip collapse; session mapping; idle re-seed; IaC for the dev account; the
Playwright done-loop + interaction suite; multi-provider parity (OpenAI/Anthropic/Google) and the
existing tool-repair logic preserved.

**Out (stop and ask if the work drifts here):** routing LLM calls through Bedrock (stay
direct-to-provider); per-user auth (keep the shared bearer secret); AgentCore Memory/Gateway
(deferred unless re-seed proves insufficient); server-side execution of CODAP tools (tools stay
client-executed — the WS just makes the round-trip cheap; the architecture enables server-side
tools later but we don't build them now); any new assistant capabilities beyond parity;
production cutover of the shipping plugin.

## Exit conditions

- **Success →** all five completion metrics met; hand off the reconcile plan.
- **Escalate (stop, report with data) →** the latency bar is unreachable after
  cold-start/optimization work; or client re-seed proves insufficient for continuity (surface the
  persistence decision — snapshot vs AgentCore Memory — rather than silently adding a store); or
  parity is non-inferior-failing on a specific interaction class.
- **Tripwire (stop, ask) →** the work starts requiring anything on the "Out" list, or AWS
  access/permissions block progress beyond a short spike.

## Open knobs (defaults chosen; adjust anytime)

- **Interaction suite:** ~8–12 interactions across modify/describe, drafted in P1 for review.
- **P4 iteration budget:** number of deploy-measure loops before stopping to report — TBD with user.
