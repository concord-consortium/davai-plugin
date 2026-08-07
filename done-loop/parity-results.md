# Parity certification (metric #1) — PASSED

Formal ≥20-runs/interaction, both tiers, against the new agent through the **real DAVAI client in real
CODAP** (Mammals sample), gpt-4o-mini:

| tier | interaction | runs | passed | check |
|---|---|---|---|---|
| describe | "how many attributes?" | 20 | **20/20** | correct answer ("9") |
| modify | "make a scatterplot of Height vs Mass" | 20 | **20/20** | CODAP document-state delta (graph created) |

**40/40 (100%)** — clears the ≥90% bar. `npx playwright test -c done-loop/harness/parity.config.ts
--repeat-each 20` (4.1 min). The agent logic is byte-identical to the old backend, so describe semantic
equivalence is inherent; here it's certified more strictly by answer-correctness, and modify by the
actual document-state change in CODAP.
