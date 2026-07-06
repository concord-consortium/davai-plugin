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
