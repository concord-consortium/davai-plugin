import {
  buildLocalSystemPrompt, buildSystemPromptParts, buildTranscriptTurns, trimToBudget,
  DEFAULT_PROMPT_BUDGET_CHARS,
} from "./local-llm-prompt";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../../constants";

it("builds the mirrored system prompt with contexts and /no_think", () => {
  const sys = buildLocalSystemPrompt({ ds: { collections: [] } }, [{ id: 1, name: "G1" }]);
  expect(sys).toContain("Role Description");
  expect(sys).toContain("### CODAP API documentation:");
  expect(sys).toContain("### Current CODAP Data Contexts:");
  expect(sys).toContain("\"ds\"");
  expect(sys).toContain("### Current CODAP Graphs:");
  expect(sys).toContain("\"G1\"");
  expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
});

it("serializes contexts compactly (no pretty-print indentation)", () => {
  const parts = buildSystemPromptParts({ ds: { collections: [] } }, [{ id: 1 }]);
  // Compact JSON.stringify (no 2-space indent) — the pretty-print newlines would be pure
  // budget cost. A pretty-printed object would contain "{\n  ".
  expect(parts.dataContexts).toBe("{\"ds\":{\"collections\":[]}}");
  expect(parts.graphs).toBe("[{\"id\":1}]");
});

it("maps the last 6 transcript turns to chat roles", () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({
    speaker: i % 2 === 0 ? USER_SPEAKER : DAVAI_SPEAKER,
    messageContent: { content: `m${i}` },
  }));
  const turns = buildTranscriptTurns(messages);
  expect(turns).toHaveLength(6);
  expect(turns[0]).toEqual({ role: "user", content: "m4" });
  expect(turns[5]).toEqual({ role: "assistant", content: "m9" });
});

it("excludes announcement-kind messages from transcript turns (DAVAI-126 I2)", () => {
  const messages = [
    { speaker: USER_SPEAKER, messageContent: { content: "describe the graph" } },
    { speaker: DAVAI_SPEAKER, messageContent: { content: "Model loading: 25% complete.", kind: "announcement" } },
    { speaker: DAVAI_SPEAKER, messageContent: { content: "The local model is ready.", kind: "announcement" } },
    { speaker: DAVAI_SPEAKER, messageContent: { content: "It is a dot plot." } },
  ];
  const turns = buildTranscriptTurns(messages);
  expect(turns).toEqual([
    { role: "user", content: "describe the graph" },
    { role: "assistant", content: "It is a dot plot." },
  ]);
  // No status chatter leaked into the model conversation.
  expect(turns.some((t) => /loading|ready/i.test(t.content))).toBe(false);
});

describe("trimToBudget (DAVAI-126 C2)", () => {
  it("fits the real assembled base prompt (incl. full API doc) within budget with >=20% margin, doc intact (DAVAI-126 context-16K)", () => {
    // Representative live contexts + graphs (a few KB), real instructions + API doc imports.
    // This is the point of the 16K context-window change: at the default budget, the full
    // mirrored prompt — instructions + the whole CODAP API doc + live contexts/graphs — must
    // fit with headroom, not just after the doc-cut safety net kicks in.
    const dataContexts = {
      Mammals: {
        collections: [{ name: "Cases", attrs: ["Mammal", "Order", "LifeSpan", "Height", "Mass", "Sleep", "Speed"] }],
      },
    };
    const graphs = [{ id: 12, name: "Height vs Mass", xAttr: "Height", yAttr: "Mass", type: "scatterPlot" }];
    const parts = buildSystemPromptParts(dataContexts, graphs);
    const turns = [
      { role: "user" as const, content: "Describe the height vs mass graph for the mammals dataset." },
    ];
    const out = trimToBudget(parts, turns);
    const total = out.reduce((n, m) => n + m.content.length, 0);
    // At least 20% margin under the default budget — real headroom, not a razor's edge.
    expect(total).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET_CHARS * 0.8);
    // The API doc survived intact: a distinctive doc substring is present, and the doc was
    // NOT replaced by the truncation marker. This is the behavior the 16K window buys us.
    expect(out[0].content).toContain("### CODAP API documentation:");
    expect(parts.apiDoc.length).toBeGreaterThan(1000); // sanity: the real doc import is non-trivial
    expect(out[0].content).toContain(parts.apiDoc.slice(0, 200));
    expect(out[0].content).not.toContain("[api documentation truncated]");
    // The live contexts and the user's question also survived the trim.
    expect(out[0].content).toContain("Mammals");
    expect(out[0].content).toContain("Height vs Mass");
    expect(out[out.length - 1].content).toContain("Describe the height vs mass graph");
  });

  it("cuts the API doc first, keeping instructions, contexts, and /no_think (DAVAI-126 C2)", () => {
    // An artificially small budget (independent of DEFAULT_PROMPT_BUDGET_CHARS, which now
    // comfortably fits the full doc — that's the point of the 16K window) too small to hold
    // the full API doc, so the doc-cut branch must fire.
    const smallBudget = (8192 - 1024) * 3;
    const parts = buildSystemPromptParts({ ds: { note: "LIVE_CONTEXT_MARKER" } }, [{ id: 9, name: "GRAPH_MARKER" }]);
    const out = trimToBudget(parts, [], smallBudget);
    const sys = out[0].content;
    // API doc cut down to a marker.
    expect(sys).toContain("[api documentation truncated]");
    // Instructions preserved.
    expect(sys).toContain("Role Description");
    // Live contexts + graphs preserved (they are what the model needs to answer).
    expect(sys).toContain("LIVE_CONTEXT_MARKER");
    expect(sys).toContain("GRAPH_MARKER");
    // /no_think always survives, at the very end.
    expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
    expect(sys.length).toBeLessThanOrEqual(smallBudget);
  });

  it("drops oldest transcript turns after cutting the doc, keeping the most recent turn", () => {
    // A tight budget that fits instructions + a trimmed doc + /no_think + exactly one turn.
    const parts = buildSystemPromptParts({}, []);
    const turns = [
      { role: "user" as const, content: "OLD_TURN " + "a".repeat(2000) },
      { role: "assistant" as const, content: "MIDDLE_TURN " + "b".repeat(2000) },
      { role: "user" as const, content: "NEWEST_TURN question" },
    ];
    const budget = parts.instructions.length + 400; // room for instructions, markers, one short turn
    const out = trimToBudget(parts, turns, budget);
    const joined = out.map((m) => m.content).join("|");
    expect(joined).toContain("NEWEST_TURN"); // most recent kept for continuity
    expect(joined).not.toContain("OLD_TURN");
    expect(joined).not.toContain("MIDDLE_TURN");
    const total = out.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(budget);
    expect(out[0].content.trimEnd().endsWith("/no_think")).toBe(true);
  });

  it("truncates the contexts tail (with marker) only as a last resort when even they overflow", () => {
    // Huge live contexts that overflow the budget even with the doc fully cut and no turns.
    const parts = buildSystemPromptParts({ ds: { blob: "X".repeat(200_000) } }, []);
    const budget = parts.instructions.length + 2000;
    const out = trimToBudget(parts, [], budget);
    const sys = out[0].content;
    expect(sys).toContain("[api documentation truncated]"); // doc cut first
    expect(sys).toContain("[context truncated]"); // then contexts clipped
    expect(sys).toContain("Role Description"); // instructions still intact
    expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
    expect(sys.length).toBeLessThanOrEqual(budget);
  });

  it("leaves a comfortably-fitting prompt untouched", () => {
    const parts = buildSystemPromptParts({ ds: {} }, []);
    const turns = [{ role: "user" as const, content: "hi" }];
    // Budget large enough for everything: nothing trimmed.
    const out = trimToBudget(parts, turns, 1_000_000);
    expect(out[0].content).not.toContain("[api documentation truncated]");
    expect(out[0].content).not.toContain("[context truncated]");
    expect(out[0].content).toContain("### CODAP API documentation:");
    expect(out[1]).toEqual({ role: "user", content: "hi" });
    expect(out[0].content.trimEnd().endsWith("/no_think")).toBe(true);
  });
});
