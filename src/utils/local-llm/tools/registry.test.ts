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

it("dispatches to validate + execute", async () => {
  await expect(dispatchTool("demo_ok", { x: "7" }, ctx)).resolves.toBe("ran with 7");
});

it("returns the corrective validation error as the tool result", async () => {
  await expect(dispatchTool("demo_ok", { x: "bad" }, ctx)).resolves.toContain("Bad x");
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
