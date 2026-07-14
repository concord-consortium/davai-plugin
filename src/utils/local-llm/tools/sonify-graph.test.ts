jest.mock("../../codap-api-utils", () => ({ getGraphByID: jest.fn() }));
jest.mock("../../graph-sonification-utils", () => ({ isGraphSonifiable: jest.fn() }));
import { getGraphByID } from "../../codap-api-utils";
import { isGraphSonifiable } from "../../graph-sonification-utils";
import { sonifyGraphTool } from "./sonify-graph";
import { ILocalToolContext } from "./registry";

const graphs = [{ id: 42, title: "Heights" }];
const setSelectedGraphID = jest.fn();
const ctx = {
  graphs: () => graphs,
  selectedGraphId: () => "42",
  setSelectedGraphID,
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  (getGraphByID as jest.Mock).mockResolvedValue({ id: 42, name: "Heights" });
});

it("selects a sonifiable graph and tells the user about the controls", async () => {
  (isGraphSonifiable as jest.Mock).mockReturnValue(true);
  const v = sonifyGraphTool.validate({}, ctx);
  expect(v.ok).toBe(true);
  const out = await sonifyGraphTool.execute((v as any).resolved, ctx);
  expect(setSelectedGraphID).toHaveBeenCalledWith(42);
  expect(out).toMatch(/sonification controls/i);
});

it("explains when the graph is not sonifiable", async () => {
  (isGraphSonifiable as jest.Mock).mockReturnValue(false);
  const v = sonifyGraphTool.validate({}, ctx);
  const out = await sonifyGraphTool.execute((v as any).resolved, ctx);
  expect(setSelectedGraphID).not.toHaveBeenCalled();
  expect(out).toMatch(/scatter plot or .*dot plot/i);
});

// Both messages use the shared, empty-string-safe graphLabel rather than falling back to a raw
// numeric id, which the model could not reliably resolve back to this graph.
describe("graphLabel wiring", () => {
  it("uses graphLabel's descriptive fallback (not the raw id) in the not-sonifiable message " +
    "when the graph has no name", async () => {
    (isGraphSonifiable as jest.Mock).mockReturnValue(false);
    (getGraphByID as jest.Mock).mockResolvedValue({ id: 42, xAttributeName: "Height", yAttributeName: "Age" });
    const v = sonifyGraphTool.validate({}, ctx);
    const out = await sonifyGraphTool.execute((v as any).resolved, ctx);
    expect(out).toContain('"the Height vs Age scatterplot"');
    expect(out).not.toContain('"42"');
  });

  it("uses graphLabel's descriptive fallback in the ready-to-sonify message when the graph has no name", async () => {
    (isGraphSonifiable as jest.Mock).mockReturnValue(true);
    (getGraphByID as jest.Mock).mockResolvedValue({ id: 42, xAttributeName: "Height" });
    const v = sonifyGraphTool.validate({}, ctx);
    const out = await sonifyGraphTool.execute((v as any).resolved, ctx);
    expect(out).toContain('"the Height dot plot"');
  });
});
