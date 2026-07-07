import { createAdornmentTool } from "./create-adornment";
import { ILocalToolContext } from "./registry";

const graphs = [{ id: 42, title: "Heights" }];
const send = jest.fn();
const ctx = {
  graphs: () => graphs,
  selectedGraphId: () => "42",
  sendCODAPRequest: send,
} as unknown as ILocalToolContext;

beforeEach(() => jest.clearAllMocks());

it("normalizes type aliases and sends the canonical adornment create", async () => {
  send.mockResolvedValue({ success: true, values: { type: "Standard Deviation", data: [{ min: 1, max: 9, mean: 5 }] } });
  const v = createAdornmentTool.validate({ type: "std dev" }, ctx);
  expect(v.ok).toBe(true);
  await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalledWith({
    action: "create",
    resource: "component[42].adornment",
    values: { type: "Standard Deviation" },
  });
});

it("reports the computed value from the create response (Mean)", async () => {
  send.mockResolvedValue({ success: true, values: { type: "Mean", data: [{ mean: 10.79 }] } });
  const v = createAdornmentTool.validate({ type: "mean" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toContain("10.79");
});

it("reports LSRL slope/intercept/rSquared", async () => {
  send.mockResolvedValue({ success: true, values: { type: "LSRL", data: [{ slope: -1.98, intercept: 46.08, rSquared: 0.29 }] } });
  const v = createAdornmentTool.validate({ type: "least squares line" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toContain("-1.98");
  expect(out).toContain("46.08");
});

it("rejects unknown types with the options list", () => {
  const v = createAdornmentTool.validate({ type: "mode" }, ctx);
  expect(v.ok).toBe(false);
  expect((v as any).error).toContain("mean");
});

it("summarizes CODAP rejection (wrong plot type) correctively using the documented top-level error shape", async () => {
  send.mockResolvedValue({ success: false, error: "not applicable" });
  const v = createAdornmentTool.validate({ type: "lsrl" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/could not be added/i);
  expect(out).toContain("not applicable");
});

it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
  send.mockResolvedValue({ success: false, values: { error: "nested not applicable" } });
  const v = createAdornmentTool.validate({ type: "lsrl" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/could not be added/i);
  expect(out).toContain("nested not applicable");
});

describe("corrective retry options on failure (DAVAI-126 eval round 2 item F)", () => {
  // A richer graph list than the top-level `graphs` fixture: one univariate (x only, no y),
  // one scatterplot (both axes), and one with neither axis set (should never be listed).
  const mixedGraphs = [
    { id: 42, title: "Heights", xAttributeName: "Height" }, // univariate
    { id: 43, title: "Height vs Mass", xAttributeName: "Height", yAttributeName: "Mass" }, // scatterplot
    { id: 44, title: "Empty" }, // neither axis — not compatible with anything
  ];
  const mixedCtx = { ...ctx, graphs: () => mixedGraphs } as unknown as ILocalToolContext;

  it("a Mean/Median/Standard-Deviation failure lists only univariate graphs (by title), " +
    "not scatterplots", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const v = createAdornmentTool.validate({ type: "mean", graph: "Heights" }, mixedCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, mixedCtx);
    expect(out).toContain("Univariate graphs: Heights.");
    expect(out).not.toContain("Height vs Mass");
  });

  it("an LSRL failure lists only scatterplots (both axes set), not univariate graphs", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const v = createAdornmentTool.validate({ type: "lsrl", graph: "Heights" }, mixedCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, mixedCtx);
    expect(out).toContain("Scatterplots: Height vs Mass.");
    expect(out).not.toContain("Univariate graphs");
  });

  it("says no compatible graph exists when none qualify", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const noneCompatibleCtx = {
      ...ctx, graphs: () => [{ id: 44, title: "Empty" }], selectedGraphId: () => "44",
    } as unknown as ILocalToolContext;
    const v = createAdornmentTool.validate({ type: "mean" }, noneCompatibleCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, noneCompatibleCtx);
    expect(out).toContain("No compatible graph exists — create one with create_graph.");
  });

  it("falls back to a graph's name when it has no title", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const untitledCtx = {
      ...ctx, graphs: () => [{ id: 50, name: "graph50", xAttributeName: "Height" }], selectedGraphId: () => "50",
    } as unknown as ILocalToolContext;
    const v = createAdornmentTool.validate({ type: "mean" }, untitledCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, untitledCtx);
    expect(out).toContain("Univariate graphs: graph50.");
  });

  // DAVAI-126 matrix round 3 item E1: the corrective's own local graphLabel was `g?.title ??
  // g?.name` with NO empty-string guard and no descriptive fallback — evidence: the live trace
  // `Univariate graphs: .` (a single empty entry) when the only candidate had title: "". Now uses
  // the shared, RESOLVABLE graphLabel from resolve.ts, which never produces an empty string.
  it("treats an empty-string title as absent (not a blank list entry) and falls through to the " +
    "descriptive fallback when name is also absent", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const emptyTitleCtx = {
      ...ctx, graphs: () => [{ id: 51, title: "", xAttributeName: "Height" }], selectedGraphId: () => "51",
    } as unknown as ILocalToolContext;
    const v = createAdornmentTool.validate({ type: "mean" }, emptyTitleCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, emptyTitleCtx);
    expect(out).toContain("Univariate graphs: the Height dot plot.");
    expect(out).not.toBe("Univariate graphs: .");
  });

  it("falls back to a descriptive phrase (not a raw id) when both title and name are absent", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const idOnlyCtx = {
      ...ctx, graphs: () => [{ id: 52, xAttributeName: "Height", yAttributeName: "Mass" }], selectedGraphId: () => "52",
    } as unknown as ILocalToolContext;
    const v = createAdornmentTool.validate({ type: "lsrl" }, idOnlyCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, idOnlyCtx);
    expect(out).toContain("Scatterplots: the Height vs Mass scatterplot.");
  });
});

// DAVAI-126 matrix round 3 item E1: resolved.graphTitle itself (used in BOTH the success and
// failure result sentences) fell back to `graph.value.title ?? graph.value.name` with no
// empty-string guard — evidence: `Added Mean adornment to "undefined"` in the live trace (an
// empty-string title coerced through a template literal). Now uses the shared graphLabel.
describe("resolved graphTitle uses the shared graphLabel (DAVAI-126 matrix round 3 E1)", () => {
  it("an empty-string title does not surface as \"undefined\" or a blank quoted label in the " +
    "success message", async () => {
    send.mockResolvedValue({ success: true, values: { type: "Mean", data: [{ mean: 10.79 }] } });
    const emptyTitleCtx = {
      ...ctx, graphs: () => [{ id: 60, title: "", xAttributeName: "Height" }], selectedGraphId: () => "60",
    } as unknown as ILocalToolContext;
    const v = createAdornmentTool.validate({ type: "mean" }, emptyTitleCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, emptyTitleCtx);
    expect(out).toContain('Added Mean adornment to "the Height dot plot"');
    expect(out).not.toContain("undefined");
    expect(out).not.toContain('to ""');
  });

  it("a title-less, name-less graph gets a descriptive label (not \"undefined\") in the failure message", async () => {
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const idOnlyCtx = {
      ...ctx, graphs: () => [{ id: 61, xAttributeName: "Height" }], selectedGraphId: () => "61",
    } as unknown as ILocalToolContext;
    const v = createAdornmentTool.validate({ type: "mean" }, idOnlyCtx);
    const out = await createAdornmentTool.execute((v as any).resolved, idOnlyCtx);
    expect(out).toContain('could not be added to "the Height dot plot"');
    expect(out).not.toContain("undefined");
  });
});
