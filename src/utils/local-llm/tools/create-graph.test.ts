import { createGraphTool } from "./create-graph";
import { ILocalToolContext } from "./registry";

const dc = { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Age" }, { name: "Habitat" }] }] };
const send = jest.fn();
const refreshGraphs = jest.fn().mockResolvedValue(undefined);
const ctx = {
  dataContexts: () => ({ Mammals: dc }),
  sendCODAPRequest: send,
  refreshGraphs,
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({ success: true, values: { id: 55, title: "Height vs Age" } });
});

it("builds a names-first component create and refreshes graphs", async () => {
  const v = createGraphTool.validate(
    { dataContext: "mammals", xAttribute: "height", yAttribute: "age", title: "Height vs Age" }, ctx);
  expect(v.ok).toBe(true);
  const out = await createGraphTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalledWith({
    action: "create",
    resource: "component",
    values: { type: "graph", dataContext: "Mammals", title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age" },
  });
  expect(refreshGraphs).toHaveBeenCalled();
  expect(out).toContain("Height vs Age");
});

it("y-axis is optional (univariate plot)", async () => {
  const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height" }, ctx);
  expect(v.ok).toBe(true);
  await createGraphTool.execute((v as any).resolved, ctx);
  expect(send.mock.calls[0][0].values.yAttributeName).toBeUndefined();
});

it("unknown attribute is caught before any request", () => {
  const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Speed" }, ctx);
  expect(v.ok).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it("summarizes CODAP failure using the documented top-level error shape", async () => {
  send.mockResolvedValue({ success: false, error: "bad component spec" });
  const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height" }, ctx);
  expect(v.ok).toBe(true);
  const out = await createGraphTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/graph creation failed/i);
  expect(out).toContain("bad component spec");
});

it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
  send.mockResolvedValue({ success: false, values: { error: "nested bad component spec" } });
  const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height" }, ctx);
  const out = await createGraphTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/graph creation failed/i);
  expect(out).toContain("nested bad component spec");
});

describe("legendAttribute (DAVAI-126 Task C)", () => {
  it("resolves and sends legendAttributeName", async () => {
    const v = createGraphTool.validate(
      { dataContext: "Mammals", xAttribute: "Height", legendAttribute: "Habitat" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "create",
      resource: "component",
      values: { type: "graph", dataContext: "Mammals", xAttributeName: "Height", legendAttributeName: "Habitat" },
    });
  });

  it("repairs a miscapitalized legendAttribute (ladder rung 2)", async () => {
    const v = createGraphTool.validate(
      { dataContext: "Mammals", xAttribute: "Height", legendAttribute: "habitat" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send.mock.calls[0][0].values.legendAttributeName).toBe("Habitat");
  });

  it("gives a corrective error on an unknown legendAttribute, before any request", () => {
    const v = createGraphTool.validate(
      { dataContext: "Mammals", xAttribute: "Height", legendAttribute: "Speed" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toContain("Habitat");
    expect(send).not.toHaveBeenCalled();
  });

  it("absent legendAttribute leaves behavior unchanged (no legendAttributeName sent)", async () => {
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send.mock.calls[0][0].values.legendAttributeName).toBeUndefined();
  });
});
