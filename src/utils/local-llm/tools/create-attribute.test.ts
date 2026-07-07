import { createAttributeTool, buildAttributeCreateRequest } from "./create-attribute";
import { ILocalToolContext } from "./registry";

const dc = {
  name: "Mammals",
  collections: [{ name: "Cases", attrs: [{ name: "Speed" }, { name: "Month" }] }],
};
const send = jest.fn();
const refreshDataContexts = jest.fn().mockResolvedValue(undefined);
const ctx = {
  dataContexts: () => ({ Mammals: dc }),
  sendCODAPRequest: send,
  refreshDataContexts,
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({ success: true, values: { attrs: [{ name: "mean_speed" }] } });
});

it("buildAttributeCreateRequest emits the array-of-specs shape", () => {
  expect(buildAttributeCreateRequest("Mammals", "Cases", "mean_speed", "mean(`Speed`)")).toEqual({
    action: "create",
    resource: "dataContext[Mammals].collection[Cases].attribute",
    values: [{ name: "mean_speed", formula: "mean(`Speed`)" }],
  });
});

it("creates a formula attribute and refreshes data contexts", async () => {
  const v = createAttributeTool.validate(
    { dataContext: "Mammals", name: "mean_speed", formula: "mean(`Speed`)" }, ctx);
  expect(v.ok).toBe(true);
  const out = await createAttributeTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalled();
  expect(refreshDataContexts).toHaveBeenCalled();
  expect(out).toContain("mean_speed");
});

it("rejects formulas referencing unknown attributes before any request", () => {
  const v = createAttributeTool.validate(
    { dataContext: "Mammals", name: "x", formula: "mean(`Velocity`)" }, ctx);
  expect(v.ok).toBe(false);
  expect((v as any).error).toContain("Speed");
  expect(send).not.toHaveBeenCalled();
});

it("rejects a name that already exists", () => {
  const v = createAttributeTool.validate({ dataContext: "Mammals", name: "Speed" }, ctx);
  expect(v.ok).toBe(false);
  expect((v as any).error).toMatch(/already exists/i);
});

// Override 2 (Task-5 review): the brief validated backticked refs but stored the RAW formula —
// the same defect fixed in select-cases.ts. Canonicalize each distinct ref once and rewrite
// every span so the sent formula uses the schema's actual attribute name (ladder rung 2 repair
// must be reflected in what CODAP receives; CODAP's formula engine is name-exact).
it("canonicalizes a repaired ref in the sent formula (ladder rung 2)", async () => {
  const v = createAttributeTool.validate(
    { dataContext: "Mammals", name: "mean_speed", formula: "mean(`speed`)" }, ctx);
  expect(v.ok).toBe(true);
  await createAttributeTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalledWith({
    action: "create",
    resource: "dataContext[Mammals].collection[Cases].attribute",
    values: [{ name: "mean_speed", formula: "mean(`Speed`)" }],
  });
});

it("summarizes CODAP failure using the documented top-level error shape", async () => {
  send.mockResolvedValue({ success: false, error: "duplicate attribute name" });
  const v = createAttributeTool.validate({ dataContext: "Mammals", name: "mean_speed" }, ctx);
  expect(v.ok).toBe(true);
  const out = await createAttributeTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/attribute creation failed/i);
  expect(out).toContain("duplicate attribute name");
});

it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
  send.mockResolvedValue({ success: false, values: { error: "nested duplicate attribute name" } });
  const v = createAttributeTool.validate({ dataContext: "Mammals", name: "mean_speed" }, ctx);
  const out = await createAttributeTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/attribute creation failed/i);
  expect(out).toContain("nested duplicate attribute name");
});

it("echoes the formula verbatim (canonicalized) in the success result " +
  "(DAVAI-126 eval round 2 item G — makes visible exactly what formula reached CODAP)", async () => {
  const v = createAttributeTool.validate(
    { dataContext: "Mammals", name: "HeightInFeet", formula: "`Speed`*3.281" }, ctx);
  expect(v.ok).toBe(true);
  const out = await createAttributeTool.execute((v as any).resolved, ctx);
  expect(out).toBe('Created attribute "HeightInFeet" in "Mammals" computed as `Speed`*3.281.');
});

it("omits the formula clause when no formula was given", async () => {
  const v = createAttributeTool.validate({ dataContext: "Mammals", name: "PlainAttr" }, ctx);
  expect(v.ok).toBe(true);
  const out = await createAttributeTool.execute((v as any).resolved, ctx);
  expect(out).toBe('Created attribute "PlainAttr" in "Mammals".');
  expect(out).not.toContain("computed as");
});
