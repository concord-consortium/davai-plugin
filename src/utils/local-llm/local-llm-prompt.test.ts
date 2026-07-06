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

it("REAL assembled base prompt (all 8 tools, representative digest+seed) fits with ≥25% margin", () => {
  initializeLocalTools();
  const digest = buildSchemaDigest({
    Mammals: { name: "Mammals", collections: [{ name: "Cases", attrs: Array.from({ length: 12 }, (_, i) => ({ name: `Attr_${i}`, type: "numeric" })) }] },
  });
  const seedValues = Array.from({ length: 100 }, (_, i) => `${i}.5, ${i * 2}.25`).join("; ");
  const seed = `Selected graph "Big" (data context: Mammals).\nx-axis: A; y-axis: B. Adornments: Mean: 10.\nValues (A, B) — 250 cases (evenly sampled 100 of 250): ${seedValues}`;
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
