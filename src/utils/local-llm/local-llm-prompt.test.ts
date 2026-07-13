import { initializeLocalTools, buildToolDocs } from "./tools";
import { buildSchemaDigest } from "./local-llm-prefetch";
import { buildLocalSystemPrompt, buildTranscriptTurns, trimToBudget, DEFAULT_PROMPT_BUDGET_CHARS } from "./local-llm-prompt";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../../constants";

it("assembles instructions + generated tool docs + digest + seed, ending with /no_think", () => {
  initializeLocalTools();
  const sys = buildLocalSystemPrompt({
    toolDocs: buildToolDocs(),
    schemaDigest: "Mammals — Cases: Height (numeric)",
    graphSeed: "Selected graph \"Heights\".\nx-axis: Height.\nValues (Height) — 2 cases: 10; 12",
  });
  expect(sys).toContain("### Tools:");
  expect(sys).toContain("get_stats");
  expect(sys).toContain("### Datasets (schema):");
  expect(sys).toContain("### Selected graph data:");
  expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
});

describe("thinking toggle (DAVAI-126)", () => {
  const baseInput = { toolDocs: "- t: d", schemaDigest: "D", graphSeed: "" };

  it("ends with /think when thinking is true", () => {
    const sys = buildLocalSystemPrompt({ ...baseInput, thinking: true });
    expect(sys.trimEnd().endsWith("/think")).toBe(true);
    expect(sys.trimEnd().endsWith("/no_think")).toBe(false);
  });

  it("ends with /no_think when thinking is false", () => {
    const sys = buildLocalSystemPrompt({ ...baseInput, thinking: false });
    expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
  });

  it("ends with /no_think when thinking is omitted (default stays today's behavior)", () => {
    const sys = buildLocalSystemPrompt(baseInput);
    expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
  });

  it("trim preserves /think under digest truncation (parallel of the /no_think survival test)", () => {
    const sys = buildLocalSystemPrompt({
      toolDocs: "- t: d\n  {\"tool\": \"t\"}",
      schemaDigest: "D".repeat(1200),
      graphSeed: `Selected graph "G".\nx-axis: A.\nValues (A) — 3 cases: ${"9".repeat(800)}`,
      thinking: true,
    });
    const user = { role: "user" as const, content: "question" };
    const tighter = trimToBudget([{ role: "system", content: sys }, user], 2000);
    expect(tighter[0].content).toContain("[schema digest truncated]");
    expect(tighter[0].content.trimEnd().endsWith("/think")).toBe(true);
    expect(tighter[0].content.trimEnd().endsWith("/no_think")).toBe(false);
  });
});

it("REAL assembled base prompt (all 12 tools, representative digest+seed) fits with ≥25% margin", () => {
  initializeLocalTools();
  const digest = buildSchemaDigest({
    Mammals: { name: "Mammals", collections: [{ name: "Cases", attrs: Array.from({ length: 12 }, (_, i) => ({ name: `Attr_${i}`, type: "numeric" })) }] },
  });
  const seedValues = Array.from({ length: 100 }, (_, i) => `${i}.5, ${i * 2}.25`).join("; ");
  const seed = `Selected graph "Big" (data context: Mammals).\nx-axis: A; y-axis: B. Adornments: Mean: 10.\nValues (A, B) — 100 cases: ${seedValues}`;
  const sys = buildLocalSystemPrompt({ toolDocs: buildToolDocs(), schemaDigest: digest, graphSeed: seed });
  expect(sys.length).toBeLessThan(DEFAULT_PROMPT_BUDGET_CHARS * 0.75);
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

it("trim drops seed values first, then turns, then truncates digest — /no_think survives", () => {
  const sys = buildLocalSystemPrompt({
    toolDocs: "- t: d\n  {\"tool\": \"t\"}",
    schemaDigest: "D".repeat(1200),
    graphSeed: `Selected graph "G".\nx-axis: A.\nValues (A) — 3 cases: ${"9".repeat(800)}`,
  });
  const turns = [
    { role: "user" as const, content: "A".repeat(500) },
    { role: "assistant" as const, content: "B".repeat(500) },
  ];
  const user = { role: "user" as const, content: "question" };
  const out = trimToBudget([{ role: "system", content: sys }, ...turns, user], sys.length - 200);
  expect(out[0].content).toContain("[graph values omitted");
  expect(out[out.length - 1]).toEqual(user);
  const tighter = trimToBudget([{ role: "system", content: sys }, ...turns, user], 2000);
  expect(tighter[0].content).toContain("[schema digest truncated]");
  expect(tighter[0].content.trimEnd().endsWith("/no_think")).toBe(true);
  expect(tighter.find((m) => m.content.startsWith("A"))).toBeUndefined();
});

// The graph sketch (computed cluster/outlier/relationship facts) lives in the seed's STRUCTURE
// section, BEFORE the Values line — trimToBudget's first trim rung locates the Values line by
// SEED_VALUES_PREFIX ("Values") and blanks only that one line, so anything placed earlier in the
// same seed (the sketch) is untouched by this rung. This is the load-bearing reason the sketch
// survives the exact budget pressure that most aggressively strips the seed.
it("trim's first rung (drop seed values) leaves the Sketch line intact — only the Values line " +
  "is blanked", () => {
  const sketchLine = "Sketch: 3 points. A 1–9 (most between 2 and 8).";
  const sys = buildLocalSystemPrompt({
    toolDocs: "- t: d\n  {\"tool\": \"t\"}",
    schemaDigest: "D".repeat(200),
    graphSeed: `Selected graph "G".\nx-axis: A.\n${sketchLine}\nValues (A) — 3 cases: ${"9".repeat(800)}`,
  });
  const user = { role: "user" as const, content: "question" };
  // Budget tight enough to force rung 1 (drop seed values) but loose enough that rungs 2-3
  // (drop transcript turns / truncate digest) never engage — isolates rung 1's behavior.
  const out = trimToBudget([{ role: "system", content: sys }, user], sys.length - 200);
  expect(out[0].content).toContain("[graph values omitted");
  expect(out[0].content).toContain(sketchLine);
  expect(out[0].content).not.toMatch(/^Values \(A\)/m);
});

// Without anchoring, `room` shrinks with the size of the CURRENT USER MESSAGE (`others` includes
// it) — a large enough user turn could drive `room` below len(instructions + tool docs) and
// slice straight through the tool documentation, silently disabling every tool call. Anchoring
// the cut to the schema-digest header's own offset ensures it can never precede it.
describe("trim never severs instructions/tool docs, regardless of what's oversized (PR #114 Gate 1)", () => {
  const toolDocs = "- t: d\n  {\"tool\": \"t\"}\n- t2: d2\n  {\"tool\": \"t2\"}";

  it("an oversized CURRENT USER MESSAGE never cuts into instructions/tool docs — only the " +
    "digest tail is truncated, with the honest label", () => {
    const sys = buildLocalSystemPrompt({ toolDocs, schemaDigest: "D".repeat(2000), graphSeed: "" });
    const prefixEnd = sys.indexOf("### Datasets (schema):");
    const untrimmedPrefix = sys.slice(0, prefixEnd);
    const hugeUserMessage = "U".repeat(5000);
    const out = trimToBudget(
      [{ role: "system", content: sys }, { role: "user", content: hugeUserMessage }],
      3000
    );
    // The never-trimmed prefix survives byte-identical.
    expect(out[0].content.slice(0, prefixEnd)).toBe(untrimmedPrefix);
    expect(out[0].content).toContain("### Tools:");
    expect(out[0].content).toContain(toolDocs);
    expect(out[0].content).toContain("[schema digest truncated]");
    // The digest itself was actually shortened (this rung did SOMETHING, not a no-op).
    expect(out[0].content).not.toContain("D".repeat(2000));
  });

  it("an oversized schema digest alone (ordinary-sized user message) hits the exact same " +
    "invariant — the digest, not the prefix, absorbs the cut", () => {
    const sys = buildLocalSystemPrompt({ toolDocs, schemaDigest: "D".repeat(50000), graphSeed: "" });
    const prefixEnd = sys.indexOf("### Datasets (schema):");
    const untrimmedPrefix = sys.slice(0, prefixEnd);
    const out = trimToBudget(
      [{ role: "system", content: sys }, { role: "user", content: "small question" }],
      500
    );
    expect(out[0].content.slice(0, prefixEnd)).toBe(untrimmedPrefix);
    expect(out[0].content).toContain(toolDocs);
    expect(out[0].content).toContain("[schema digest truncated]");
  });

  it("the never-trimmed prefix is byte-identical pre- and post-trim under aggressive pressure " +
    "from BOTH an oversized digest and an oversized user message at once", () => {
    const sys = buildLocalSystemPrompt({ toolDocs, schemaDigest: "D".repeat(3000), graphSeed: "" });
    const prefixEnd = sys.indexOf("### Datasets (schema):");
    const before = sys.slice(0, prefixEnd);
    const out = trimToBudget(
      [{ role: "system", content: sys }, { role: "user", content: "U".repeat(6000) }],
      1000
    );
    expect(out[0].content.slice(0, prefixEnd)).toBe(before);
  });

  it("even when the untrimmable prefix alone exceeds the whole budget, it is kept WHOLE rather " +
    "than cut — overshooting the budget beats disabling every tool call", () => {
    const sys = buildLocalSystemPrompt({ toolDocs, schemaDigest: "D".repeat(500), graphSeed: "" });
    const prefixEnd = sys.indexOf("### Datasets (schema):");
    const out = trimToBudget(
      [{ role: "system", content: sys }, { role: "user", content: "hi" }],
      // A budget far smaller than the prefix itself.
      Math.floor(prefixEnd / 4)
    );
    expect(out[0].content.slice(0, prefixEnd)).toBe(sys.slice(0, prefixEnd));
    expect(out[0].content).toContain(toolDocs);
  });
});
