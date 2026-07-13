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

// When args.title is absent/empty, default to a real title (bivariate: "X vs Y"; univariate:
// "X") and SEND it to CODAP.
describe("default title (DAVAI-126 matrix round 3 E4)", () => {
  it("omitted title on a bivariate graph defaults to \"X vs Y\" and SENDS it to CODAP", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "Height vs Age" } });
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "create",
      resource: "component",
      values: { type: "graph", dataContext: "Mammals", title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age" },
    });
  });

  it("omitted title on a univariate graph defaults to just \"X\" and SENDS it to CODAP", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "Height" } });
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "create",
      resource: "component",
      values: { type: "graph", dataContext: "Mammals", title: "Height", xAttributeName: "Height" },
    });
  });

  it("empty-string title is treated the SAME as omitted (defaults and sends), not as an intentional blank", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "Height vs Age" } });
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age", title: "" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send.mock.calls[0][0].values.title).toBe("Height vs Age");
  });

  it("the result string uses the default title", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "Height vs Age" } });
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age" }, ctx);
    const out = await createGraphTool.execute((v as any).resolved, ctx);
    expect(out).toContain('Created graph "Height vs Age"');
  });

  it("an explicit title is unchanged: sent verbatim, not overridden by the default", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "My Custom Title" } });
    const v = createGraphTool.validate(
      { dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age", title: "My Custom Title" }, ctx);
    await createGraphTool.execute((v as any).resolved, ctx);
    expect(send.mock.calls[0][0].values.title).toBe("My Custom Title");
  });

  it("prefers CODAP's echoed title over the default when they differ", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "CODAP Renamed It" } });
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age" }, ctx);
    const out = await createGraphTool.execute((v as any).resolved, ctx);
    expect(out).toContain('Created graph "CODAP Renamed It"');
  });

  it("an empty-string echo from CODAP counts as absent — falls back to our own default title, " +
    "not a blank", async () => {
    send.mockResolvedValue({ success: true, values: { id: 55, title: "" } });
    const v = createGraphTool.validate({ dataContext: "Mammals", xAttribute: "Height", yAttribute: "Age" }, ctx);
    const out = await createGraphTool.execute((v as any).resolved, ctx);
    expect(out).toContain('Created graph "Height vs Age"');
    expect(out).not.toContain('Created graph ""');
  });
});

describe("legendAttribute (DAVAI-126 Task C)", () => {
  it("resolves and sends legendAttributeName", async () => {
    const v = createGraphTool.validate(
      { dataContext: "Mammals", xAttribute: "Height", legendAttribute: "Habitat" }, ctx);
    expect(v.ok).toBe(true);
    await createGraphTool.execute((v as any).resolved, ctx);
    // An omitted title defaults to "Height" (univariate) and IS sent to CODAP — see the "default
    // title" describe block below for full coverage.
    expect(send).toHaveBeenCalledWith({
      action: "create",
      resource: "component",
      values: { type: "graph", dataContext: "Mammals", title: "Height", xAttributeName: "Height", legendAttributeName: "Habitat" },
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
