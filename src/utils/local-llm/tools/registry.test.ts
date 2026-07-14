import { registerTools, getRegisteredTools, dispatchTool, buildToolDocs, ILocalTool, ILocalToolContext } from "./registry";

const ctx = {} as ILocalToolContext;

const okTool: ILocalTool = {
  name: "demo_ok",
  description: "Demo tool.",
  argsExample: '{"tool": "demo_ok", "x": "1"}',
  validate: (args) => (args.x === "bad"
    ? { ok: false, error: "Bad x. Available: 1, 2." }
    : { ok: true, resolved: { x: args.x } }),
  execute: async (resolved) => `ran with ${resolved.x}`,
};
const throwTool: ILocalTool = {
  name: "demo_throw",
  description: "Always throws.",
  argsExample: '{"tool": "demo_throw"}',
  validate: () => ({ ok: true, resolved: {} }),
  execute: async () => { throw new Error("kaboom"); },
};
const validateThrowTool: ILocalTool = {
  name: "demo_validate_throw",
  description: "Validate always throws.",
  argsExample: '{"tool": "demo_validate_throw"}',
  validate: () => { throw new Error("validate blew up"); },
  execute: async () => "unreachable",
};

beforeEach(() => registerTools([okTool, throwTool, validateThrowTool]));

// Dev-time guard: a copy-pasted tool file that forgets to rename its `name` field would silently
// shadow an earlier tool with no error at all — buildToolDocs would document one, dispatchTool
// would only ever reach the LAST one registered under that name, and the earlier tool becomes
// permanently unreachable. Catch this at registration time instead.
it("registerTools throws on a duplicate tool name", () => {
  const duplicate: ILocalTool = { ...throwTool, name: "demo_ok" };
  expect(() => registerTools([okTool, duplicate])).toThrow(/duplicate/i);
  expect(() => registerTools([okTool, duplicate])).toThrow(/demo_ok/);
});

it("dispatches to validate + execute", async () => {
  await expect(dispatchTool("demo_ok", { x: "7" }, ctx)).resolves.toBe("ran with 7");
});

it("returns the corrective validation error as the tool result", async () => {
  await expect(dispatchTool("demo_ok", { x: "bad" }, ctx)).resolves.toContain("Bad x");
});

// A uniform, explicit "call again / don't repeat / don't answer with this" instruction appended
// to every validation failure (regardless of which tool) removes the ambiguity at the dispatch
// layer, so no per-tool error string has to remember to say it.
it("appends a uniform retry instruction naming the tool to every validation failure", async () => {
  const out = await dispatchTool("demo_ok", { x: "bad" }, ctx);
  expect(out).toBe(
    "Bad x. Available: 1, 2. Call demo_ok again now with a corrected argument — do not repeat " +
    "the same arguments, and do not answer with this message's text."
  );
});

it("unknown tool yields a corrective result listing tool names — never rejects", async () => {
  const out = await dispatchTool("nope", {}, ctx);
  expect(out).toContain('Unknown tool "nope"');
  expect(out).toContain("demo_ok");
  expect(out).toContain("demo_throw");
});

it("execute exceptions become error strings — never rejects", async () => {
  const out = await dispatchTool("demo_throw", {}, ctx);
  expect(out).toMatch(/error/i);
  expect(out).toContain("kaboom");
});

it("validate exceptions also become error strings — never rejects", async () => {
  const out = await dispatchTool("demo_validate_throw", {}, ctx);
  expect(out).toMatch(/error/i);
  expect(out).toContain("validate blew up");
});

it("buildToolDocs includes every registered tool's name, description, and args example", () => {
  const docs = buildToolDocs();
  for (const t of getRegisteredTools()) {
    expect(docs).toContain(t.name);
    expect(docs).toContain(t.description);
    expect(docs).toContain(t.argsExample);
  }
});

import { initializeLocalTools } from "./index";

it("initializeLocalTools registers all 12 tools with docs for each", () => {
  initializeLocalTools();
  const names = getRegisteredTools().map((t) => t.name).sort();
  expect(names).toEqual([
    "create_adornment", "create_attribute", "create_graph", "find_cases", "get_case_values",
    "get_graph_info", "get_stats", "group_by", "select_cases", "sonify_graph", "update_attribute",
    "update_graph",
  ]);
});

// Registration order IS prompt order (buildToolDocs, registry.ts, maps registered tools in array
// order) — find_cases is registered above get_case_values to raise its salience, without
// touching the (alphabetically-asserted, so order-independent) full-registry test above.
it("registers find_cases ABOVE get_case_values (prompt order = salience)", () => {
  initializeLocalTools();
  const names = getRegisteredTools().map((t) => t.name);
  const findCasesIdx = names.indexOf("find_cases");
  const getCaseValuesIdx = names.indexOf("get_case_values");
  expect(findCasesIdx).toBeGreaterThanOrEqual(0);
  expect(getCaseValuesIdx).toBeGreaterThanOrEqual(0);
  expect(findCasesIdx).toBeLessThan(getCaseValuesIdx);
});
