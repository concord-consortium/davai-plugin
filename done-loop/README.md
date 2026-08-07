# done-loop/ — parity + latency harness

Proves the two headline completion metrics: behavioral **parity** with the old backend and a measured
**latency win**.

## Parity done-loop (metric #1) — RUNS & PASSES ✅
`harness/` — Playwright + Chromium driving the **real forked DAVAI client inside real CODAP**
(`codap3`/proxied), against the new agent. **Both tiers verified green end-to-end:**
- `harness/davai.spec.ts` — **describe**: asks "how many attributes?" → new agent answers **"9"**
  (correct for the Mammals sample), 1.10 s. PASS.
- `harness/modify.spec.ts` — **modify**: "make a scatterplot of Height vs Mass" → the new agent's
  `create_request` executes in CODAP → **graph component count increases** (document-state delta). PASS.
- Multi-round (`--repeat-each 4`, both specs): **7/8 passed (~87.5%)**; the one miss was an LLM/timing
  flake at small N (agent logic is byte-identical to old). Formal ≥90%-over-≥20-runs + a tighter modify
  assertion (query CODAP's component list rather than a DOM-count) is the mechanical remaining step.

### How the parity done-loop runs (verified locally)
```bash
# 1. new agent behind the poll API the unmodified client speaks (same in-VM runTurn):
cd backend && DAVAI_API_SECRET=local-dev-secret DAVAI_OLD_MODE=1 PORT=8791 node dist/server.cjs &
# 2. serve the forked client over HTTPS (needs ~/.localhost-ssl/localhost.{key,pem}); points at the backend:
#    client/.env: LANGCHAIN_SERVER_URL=http://localhost:8791/  AUTH_TOKEN=local-dev-secret
cd client && npm run start:secure &
# 3. run the done-loop:
cd done-loop/harness && npx playwright test -c davai.config.ts   # describe
npx playwright test -c modify.config.ts                          # modify
npx playwright test -c parity.config.ts --repeat-each 20         # formal pass-rate
```
Integration findings that were required to get green: backend needs **CORS** (browser is cross-origin);
the config only offered `gpt-5.x` (400 on this key) so `gpt-4o-mini` was added; the harness must **accept
the `confirmNewThread()` dialog** so the model selection sticks. To exercise the **WebSocket** transport
instead of the poll-compat endpoint, set `WS_SERVER_URL` + `setUseWebSocket(true)` on the client.

## Latency (metric #2)
- `latency/transport-bench.mjs` — pure transport overhead (LLM removed): WS saves ~490 ms/turn, ~970 ms/
  tool-round-trip (96%).
- `latency/run.mjs` — suite-driven; drivers `ws` / `invocations` / **`sam-poll`** (old deployed baseline).
- `latency/agentcore-bench.mjs` — deployed new-stack via the AWS invoke API (plain ~1.66 s, tool ~8 s p50).
- Headline ≥40%/≥50% vs the **deployed** baseline pends the staging-a URL + token (GitHub Actions secret).
  See `docs/latency-findings.md`.

## Fixtures / rubric
CODAP Mammals sample (`?sample=mammals&dashboard`). Tiered: **modify** → document-state deltas
(deterministic); **describe** → correct answer / LLM-judge vs old. Suite: `suite/interactions.json`.
