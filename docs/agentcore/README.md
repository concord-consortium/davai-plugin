# DAVAI on AgentCore — migration proof-of-concept

This directory documents an **additive, opt-in** proof-of-concept that re-hosts the DAVAI backend on
**AWS Bedrock AgentCore** (per-session microVM holding context in memory — no SQS / RDS Postgres / job
table) with a **WebSocket** transport replacing the client's poll loop, preserving the LangGraph-JS agent.

**Nothing here changes default behavior.** `sam-server` and the poll path are untouched; the WebSocket
client transport ships behind a default-off `useWebSocket` flag.

- **[report.html](./report.html)** — one-page report (scorecard, latency chart, reconcile plan).
  Live: <https://concord-consortium.github.io/davai-agentcore/>
- **[P5-final-report.md](./P5-final-report.md)** — outcome, what was built, and the reconcile plan.
- **[design.md](./design.md)** — architecture + component design. **[GOAL.md](./GOAL.md)** — the charter.
- **[latency-findings.md](./latency-findings.md)** — the old-vs-new measurements + why tool-calling is LLM-bound.
- **`research/`** — AgentCore brief, current-backend map, CODAP test-harness findings.

## What this PR adds
- **`backend/`** — the AgentCore BYO container (LangGraph-JS agent + in-VM checkpointer; `/invocations`,
  `/ping`, `/ws`). Standalone from `sam-server`.
- **`infra/`** — least-privilege IAM + deploy runbook + teardown.
- **`done-loop/`** — Playwright parity harness (real client in real CODAP; 40/40 certification) + latency tooling.
- **`src/utils/ws-transport.ts`** (+ tests) and the flagged wiring in **`src/models/assistant-model.ts`**.

## Results (all five acceptance metrics satisfied)
Parity 40/40 · in-VM/no-Postgres proven live on AgentCore · same container local+cloud · deployed & green ·
latency overall p50 −43% (tool-calling LLM-bound — accepted). Full experiment repo:
<https://github.com/concord-consortium/davai-agentcore>.

## Not built (production follow-up)
A client-reachable auth path to the deployed runtime — AgentCore's invoke is a SigV4 AWS API, so the
browser needs a thin **SigV4 proxy** or AgentCore **OAuth inbound auth**. See the reconcile plan.
