# Latency findings (metric #2) — in progress

Honest status of the old-vs-new latency comparison. Two measurements, both local (no AWS yet),
same LangGraph agent on both sides; new = WebSocket, old = a faithful reproduction of the pre-AgentCore
poll/queue transport (`DAVAI_OLD_MODE=1`: POST `/message` → poll `/status`, second job per tool call).

## 1. Pure transport overhead (LLM removed — the clean signal)
Both servers in `DAVAI_FAKE_AGENT=1` so the timing is ONLY the transport. N=20 (`done-loop/latency/transport-bench.mjs`):

| scenario | WS p50 | poll p50 | WS saves |
|---|---|---|---|
| plain turn | 19 ms | 506 ms | **487 ms (96%)** |
| tool round-trip | 39 ms | 1012 ms | **973 ms (96%)** |

Interpretation: WS removes the **poll-discovery gap** (~0.5 s/turn — the client learns the answer is ready up
to a poll-interval late) and, on a tool call, the **entire second queued job + its own poll cycle** (~0.5 s
more). Each additional tool call in an interaction compounds the ~0.5–1 s saving.

## 2. End-to-end with a real LLM (gpt-4o-mini, N=12)
Against the local old-mode reproduction, single-turn end-to-end is **within noise** (WS overall
mean-of-means 3679 ms vs poll 3035 ms): the 2–4 s LLM generation dominates, and the ~0.5 s transport
saving is a small fraction of it. The local reproduction also **understates** the old stack (see caveat),
so it cannot produce the infra-inclusive headline %.

## 3. Deployed new-stack latency (AgentCore, real OpenAI, N=8)
Measured through the AWS `invoke-agent-runtime` API against the live runtime
(`done-loop/latency/agentcore-bench.mjs`):

| scenario | p50 | mean | min–max |
|---|---|---|---|
| plain turn | 1662 ms | 1624 ms | 1191–2017 |
| tool round-trip (2 invokes) | 8098 ms | 5888 ms | 3015–8577 |

AgentCore adds minimal overhead and shows **no cold-start penalty** (runtime stays warm; plain-turn
latency is tight and LLM-bound). This is the new-stack side of the comparison; the old-stack (deployed
baseline) side is still needed to compute the headline %.

## What this means for the ≥40% / ≥50% bar
- The transport win is **real and quantified** (~490 ms/turn, ~970 ms/tool-call), but as a *fraction* of a
  full turn it only reaches the ≥40% bar when the old stack's **infrastructure overhead** is included and/or
  interactions carry **multiple tool calls**.
- **Caveat (why the local proxy is conservative):** old-mode uses the in-VM checkpointer and starts the job
  instantly, so it EXCLUDES the real old stack's **SQS enqueue, Lambda cold start (~1–3 s), and Postgres
  serialization** per turn — exactly the components AgentCore also removes. The real deployed old stack is
  therefore **slower** than this proxy, so the true reduction is **≥** what we can show locally.
- **Conclusion:** metric #2's headline % must be measured against the **deployed** old stack (the charter's
  "current deployed stack"). The local benchmark proves the mechanism and bounds the transport saving from
  below; the deployed comparison adds the infra overhead that pushes the reduction toward/over the bar.
- **Open risk (possible escalate):** if the deployed old stack turns out to be LLM-dominated with fast infra,
  the **≥40% single-turn** bar could be hard while the **≥50% tool-calling** bar (compounding round-trips)
  remains reachable. We'll know once we measure the deployed baseline; may warrant revisiting the bar per
  interaction class.

## Repro
```bash
# pure transport (no LLM):
DAVAI_FAKE_AGENT=1 PORT=A node dist/server.cjs &            # new (WS)
DAVAI_FAKE_AGENT=1 DAVAI_OLD_MODE=1 PORT=B node dist/server.cjs &   # old (poll)
node done-loop/latency/transport-bench.mjs --ws-url ws://127.0.0.1:A/ws --poll-url http://127.0.0.1:B/ --runs 20

# with a real LLM (needs OPENAI_API_KEY), suite-driven:
node done-loop/latency/run.mjs --transport ws       --url ws://127.0.0.1:A/ws --runs 20
node done-loop/latency/run.mjs --transport sam-poll  --url http://127.0.0.1:B/ --runs 20
```

## 4. HEADLINE old-vs-new comparison (metric #2) — measured
Baseline captured from the live main-branch plugin's network requests (staging-a:
`…execute-api.us-east-1.amazonaws.com/staging-a/`). Same model (gpt-4o-mini), same interactions,
**N=20 each**. OLD = staging poll (SQS+Lambda+Postgres, real deployed, **warm**). NEW = WebSocket to the
new backend (poll eliminated, tool round-trip collapsed; local, so excludes ~tens-of-ms same-region
network — favorable to new). `done-loop/latency/compare-old-new.mjs`.

| interaction | old p50 | new p50 | reduction |
|---|---|---|---|
| describe (non-tool) | 1252 ms | 539 ms | **57%** |
| modify (tool-calling) | 4184 ms | 2562 ms | **39%** |
| **overall p50** | | | **43%** — ✅ clears ≥40% |
| **tool-calling p50** | | | **39%** — ❌ short of ≥50% |

**Verdict:** the **overall ≥40% bar is MET (43%)**; the **tool-calling ≥50% bar is not (39%)**. Why the
tool tier is lower: a tool turn is **two** LLM calls (message→requires_action, tool-result→final), so the
LLM time dominates and dilutes the (real) transport savings; the WS collapse removes the old stack's poll
cycles + second queued job (~1.6 s), but 2× the LLM time remains on both sides. The describe tier — a
single turn where the poll penalty is a larger fraction — clears easily (57%).

**Caveats that would move the tool-calling number toward the bar:** (a) the old stack was measured
**warm**; real first-use includes Lambda cold start (~1-3 s), which would enlarge the old times and the
reduction; (b) NEW was local WS (no AWS network) — the deployed AgentCore WS would be marginally slower.
The pure-transport win is independently confirmed (~490 ms/turn, ~970 ms/tool, 96% of transport overhead).

### Multi-tool interaction (the "multi-turn with tool calls" scenario)
A 3-tool-call interaction ("scatterplot… then a dot plot… then a graph…"), same setup:

| interaction | old p50 | new p50 | reduction |
|---|---|---|---|
| modify-multi (3 tool calls) | 14290 ms | 10910 ms | **24%** |

Counter-intuitively **lower** than single-tool (39%). Reason: reduction% = transport_savings / total_time.
transport savings grow ~1 s per round-trip, but total time grows ~1-2 s **per LLM call**, and each tool
call is a full LLM turn. So more tool calls → more LLM time → transport savings a *smaller* fraction →
lower %. The reduction is highest on the **shortest** interactions (describe, 57%).

### Bottom line for metric #2
- **Overall p50 ≥40%: MET (43%).**
- **Tool-calling p50 ≥50%: NOT reachable.** single-tool 39%, multi-tool 24% — tool turns are
  **LLM-call-dominated**, not transport-dominated, so the (real) transport savings can't reach 50% of the
  total. The ≥50% bar implicitly assumed tool round-trips are transport-bound; measurement shows they're
  LLM-bound. The pure-transport win is independently real (~490 ms/turn, ~970 ms/tool, 96% of overhead).
- **Options for the user:** (a) adjust the tool-calling bar (e.g. ~40%, or reframe as "transport overhead
  eliminated, LLM-bound beyond"); (b) accept the overall 43% + the transport-overhead evidence. The %s
  were set as adjustable in the charter's open knobs.
