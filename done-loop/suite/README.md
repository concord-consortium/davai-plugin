# Interaction suite (P1 — DRAFT for review)

`interactions.json` is the fixed set the done-loop replays against both the old (deployed, polling)
and new (AgentCore, WebSocket) stacks. **12 interactions**, two classes:

- **modify** (7) — tool-calling. DAVAI issues a `create_request` the client executes against CODAP.
  Judged **deterministically** on the resulting **document-state delta** (graph exists with the right
  axes/legend, attribute created with a formula, cases selected, attribute hidden, collection grouped)
  read back via `@concord-consortium/codap-plugin-api` `get*` helpers / the CODAP API Tester.
- **describe** (5) — non-tool. DAVAI answers from the `dataContexts`/`graphs` embedded in its system
  prompt. Judged by an **LLM-judge** for semantic equivalence to the old backend's answer.

This split also drives the latency metric's two buckets: **tool-calling** interactions (the modify set,
which carry the round-trip cost the WebSocket collapses) vs **overall**.

**Fixture:** CODAP's built-in **Mammals** sample (`?sample=mammals&dashboard`) — a stable known dataset.
The runner should snapshot exact case/attribute counts at run time, not hard-code them.

## Open review questions for the user
- Are these the right interactions, or add/remove any (e.g., sonification via `sonify_graph`, multi-turn
  follow-ups)?
- Tolerances for the numeric `describe` judgments (e.g., average lifespan) — how strict?
- Should any `modify` interaction be a **multi-turn** sequence (build a graph, then recolor it) to stress
  the session-pinned in-VM state across turns?

_Consumed by `done-loop/latency/` (timing) and `done-loop/judge/` (semantic scoring), both built in P1
once a provider key + the deployed baseline are available._
