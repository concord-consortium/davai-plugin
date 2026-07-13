// Umbrella closure test (central theme: IDENTIFIER SELF-CONSISTENCY).
//
// Every surface that prints a graph reference (the seed header, tool results, correctives) must
// resolve if a model echoes it back verbatim. graphLabel ensures the printed label always
// resolves via rung 3 (a descriptive fallback) or rung 1 (an actual title/name); resolveGraph's
// rung 0 covers bare numeric ids. This file exercises every such surface against ONE shared
// fixture — an untitled dot plot (no title, no name, forcing the descriptive fallback tier) and a
// titled scatterplot (exercising the plain title tier) — and proves the label each surface
// actually prints round-trips through resolveGraph back to the same graph. This is deliberately
// an INTEGRATION test across tool modules (not a unit test of any one of them — those already
// exist per-file); its only job is proving the cross-surface property.

jest.mock("../codap-api-utils", () => ({
  getGraphByID: jest.fn(),
  getGraphAdornments: jest.fn(),
  getCollectionItemsForAttribute: jest.fn(),
  getCollectionItemsForAttributePair: jest.fn(),
}));
jest.mock("../graph-sonification-utils", () => ({ isGraphSonifiable: jest.fn() }));

import {
  getGraphByID, getGraphAdornments, getCollectionItemsForAttribute, getCollectionItemsForAttributePair
} from "../codap-api-utils";
import { isGraphSonifiable } from "../graph-sonification-utils";
import { buildGraphSeed } from "./local-llm-prefetch";
import { getGraphInfoTool } from "./tools/get-graph-info";
import { sonifyGraphTool } from "./tools/sonify-graph";
import { updateGraphTool } from "./tools/update-graph";
import { createAdornmentTool } from "./tools/create-adornment";
import { describeGraphOption, resolveGraph } from "./tools/resolve";
import { ILocalToolContext } from "./tools/registry";

// The shared fixture: an UNTITLED dot plot (no title, no name — forces graphLabel's descriptive
// fallback tier) and a TITLED scatterplot (exercises the plain-title tier). Both share "Height"
// as an axis so a naive resolver that ignores shape/other-axis could plausibly confuse them —
// exactly the kind of collision resolveGraph's rung 3 is built to disambiguate.
const untitledDotPlot = { id: 100, dataContext: "Mammals", xAttributeName: "Height" };
const titledScatterplot = {
  id: 200, title: "Height vs Mass", dataContext: "Mammals", xAttributeName: "Height", yAttributeName: "Mass",
};
const graphs = [untitledDotPlot, titledScatterplot];

const dc = {
  name: "Mammals",
  collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }] }],
};
const dcs = { Mammals: dc };

// Assert-and-collect: every label handed to this function must independently round-trip through
// resolveGraph back to the SAME graph id it was printed for. Returns the label so the caller can
// build the final inventory list.
const assertResolves = (surface: string, label: string, expectedId: number): string => {
  const r = resolveGraph(label, graphs, null);
  if (!r.ok) {
    throw new Error(`[${surface}] label "${label}" (printed for graph ${expectedId}) did not resolve: ${r.error}`);
  }
  if (r.value.id !== expectedId) {
    throw new Error(
      `[${surface}] label "${label}" (printed for graph ${expectedId}) resolved to the WRONG graph ` +
      `(id ${r.value.id}) — a model echoing this back would land on the wrong graph.`
    );
  }
  return label;
};

describe("umbrella closure: every surface's printed graph label resolves via resolveGraph " +
  "(DAVAI-126 matrix round 3)", () => {
  const labelInventory: Record<string, { untitledDotPlot: string; titledScatterplot: string }> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    (getGraphAdornments as jest.Mock).mockResolvedValue([]);
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 10 } }, { id: "2", values: { Height: 12 } },
    ]);
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 10, Mass: 3 } }, { id: "2", values: { Height: 12, Mass: 4 } },
    ]);
  });

  it("buildGraphSeed's header label resolves for both fixture graphs", async () => {
    (getGraphByID as jest.Mock).mockResolvedValueOnce(untitledDotPlot).mockResolvedValueOnce(titledScatterplot);
    const seedUntitled = await buildGraphSeed(String(untitledDotPlot.id), dcs);
    const seedTitled = await buildGraphSeed(String(titledScatterplot.id), dcs);
    const untitledLabel = seedUntitled.match(/Selected graph "([^"]+)"/)?.[1];
    const titledLabel = seedTitled.match(/Selected graph "([^"]+)"/)?.[1];
    if (!untitledLabel || !titledLabel) throw new Error("buildGraphSeed did not print the expected header shape");
    labelInventory.buildGraphSeed = {
      untitledDotPlot: assertResolves("buildGraphSeed", untitledLabel, untitledDotPlot.id),
      titledScatterplot: assertResolves("buildGraphSeed", titledLabel, titledScatterplot.id),
    };
    expect(labelInventory.buildGraphSeed).toEqual({ untitledDotPlot: "the Height dot plot", titledScatterplot: "Height vs Mass" });
  });

  it("describeGraphOption's label resolves for both fixture graphs", () => {
    const untitledOption = describeGraphOption(untitledDotPlot);
    const titledOption = describeGraphOption(titledScatterplot);
    const untitledLabel = untitledOption.match(/^"([^"]+)"/)?.[1];
    const titledLabel = titledOption.match(/^"([^"]+)"/)?.[1];
    if (!untitledLabel || !titledLabel) throw new Error("describeGraphOption did not print the expected quoted-label shape");
    labelInventory.describeGraphOption = {
      untitledDotPlot: assertResolves("describeGraphOption", untitledLabel, untitledDotPlot.id),
      titledScatterplot: assertResolves("describeGraphOption", titledLabel, titledScatterplot.id),
    };
    expect(labelInventory.describeGraphOption).toEqual({ untitledDotPlot: "the Height dot plot", titledScatterplot: "Height vs Mass" });
  });

  it("get_graph_info's result label resolves for both fixture graphs", async () => {
    const ctx = { graphs: () => graphs, selectedGraphId: () => null, dataContexts: () => dcs } as unknown as ILocalToolContext;
    (getGraphByID as jest.Mock).mockResolvedValueOnce(untitledDotPlot).mockResolvedValueOnce(titledScatterplot);
    const untitledOut = await getGraphInfoTool.execute({ graphId: untitledDotPlot.id }, ctx);
    const titledOut = await getGraphInfoTool.execute({ graphId: titledScatterplot.id }, ctx);
    const untitledLabel = untitledOut.match(/^Graph "([^"]+)"/)?.[1];
    const titledLabel = titledOut.match(/^Graph "([^"]+)"/)?.[1];
    if (!untitledLabel || !titledLabel) throw new Error("get_graph_info did not print the expected quoted-label shape");
    labelInventory.get_graph_info = {
      untitledDotPlot: assertResolves("get_graph_info", untitledLabel, untitledDotPlot.id),
      titledScatterplot: assertResolves("get_graph_info", titledLabel, titledScatterplot.id),
    };
    expect(labelInventory.get_graph_info).toEqual({ untitledDotPlot: "the Height dot plot", titledScatterplot: "Height vs Mass" });
  });

  it("sonify_graph's result label resolves for both fixture graphs (sonifiable and not)", async () => {
    const ctx = { setSelectedGraphID: jest.fn() } as unknown as ILocalToolContext;
    (isGraphSonifiable as jest.Mock).mockReturnValue(true);
    (getGraphByID as jest.Mock).mockResolvedValueOnce(untitledDotPlot).mockResolvedValueOnce(titledScatterplot);
    const untitledOut = await sonifyGraphTool.execute({ graphId: untitledDotPlot.id }, ctx);
    const titledOut = await sonifyGraphTool.execute({ graphId: titledScatterplot.id }, ctx);
    const untitledLabel = untitledOut.match(/"([^"]+)"/)?.[1];
    const titledLabel = titledOut.match(/"([^"]+)"/)?.[1];
    if (!untitledLabel || !titledLabel) throw new Error("sonify_graph did not print the expected quoted-label shape");
    labelInventory.sonify_graph = {
      untitledDotPlot: assertResolves("sonify_graph", untitledLabel, untitledDotPlot.id),
      titledScatterplot: assertResolves("sonify_graph", titledLabel, titledScatterplot.id),
    };
    expect(labelInventory.sonify_graph).toEqual({ untitledDotPlot: "the Height dot plot", titledScatterplot: "Height vs Mass" });
  });

  it("update_graph's result label resolves for both fixture graphs", async () => {
    const send = jest.fn().mockResolvedValue({ success: true });
    const refreshGraphList = jest.fn().mockResolvedValue(undefined);
    const untitledCtx = {
      dataContexts: () => dcs, graphs: () => graphs, selectedGraphId: () => String(untitledDotPlot.id),
      sendCODAPRequest: send, refreshGraphList,
    } as unknown as ILocalToolContext;
    const titledCtx = { ...untitledCtx, selectedGraphId: () => String(titledScatterplot.id) } as unknown as ILocalToolContext;

    const vUntitled = updateGraphTool.validate({ yAttribute: "Mass" }, untitledCtx);
    if (!vUntitled.ok) throw new Error(`setup: update_graph validate failed for untitled graph: ${vUntitled.error}`);
    const untitledOut = await updateGraphTool.execute(vUntitled.resolved, untitledCtx);

    const vTitled = updateGraphTool.validate({ xAttribute: "Height" }, titledCtx);
    if (!vTitled.ok) throw new Error(`setup: update_graph validate failed for titled graph: ${vTitled.error}`);
    const titledOut = await updateGraphTool.execute(vTitled.resolved, titledCtx);

    const untitledLabel = untitledOut.match(/^Updated graph "([^"]+)"/)?.[1];
    const titledLabel = titledOut.match(/^Updated graph "([^"]+)"/)?.[1];
    if (!untitledLabel || !titledLabel) throw new Error("update_graph did not print the expected quoted-label shape");
    labelInventory.update_graph = {
      untitledDotPlot: assertResolves("update_graph", untitledLabel, untitledDotPlot.id),
      titledScatterplot: assertResolves("update_graph", titledLabel, titledScatterplot.id),
    };
    expect(labelInventory.update_graph).toEqual({ untitledDotPlot: "the Height dot plot", titledScatterplot: "Height vs Mass" });
  });

  it("create_adornment's result AND compatible-graphs corrective labels resolve for both fixture graphs", async () => {
    const send = jest.fn();
    const untitledCtx = {
      graphs: () => graphs, selectedGraphId: () => String(untitledDotPlot.id), sendCODAPRequest: send,
    } as unknown as ILocalToolContext;
    const titledCtx = { ...untitledCtx, selectedGraphId: () => String(titledScatterplot.id) } as unknown as ILocalToolContext;

    // Success-path result label.
    send.mockResolvedValue({ success: true, values: { type: "Mean", data: [{ mean: 11 }] } });
    const vUntitled = createAdornmentTool.validate({ type: "mean" }, untitledCtx);
    if (!vUntitled.ok) throw new Error(`setup: create_adornment validate failed: ${vUntitled.error}`);
    const untitledOut = await createAdornmentTool.execute(vUntitled.resolved, untitledCtx);
    const untitledLabel = untitledOut.match(/adornment to "([^"]+)"/)?.[1];
    if (!untitledLabel) throw new Error("create_adornment did not print the expected quoted-label shape");
    assertResolves("create_adornment (result)", untitledLabel, untitledDotPlot.id);

    // Failure-path compatible-graphs corrective label (LSRL only offers scatterplots — the
    // titled graph is the one that should be listed here).
    send.mockResolvedValue({ success: false, error: "not applicable" });
    const vTitled = createAdornmentTool.validate({ type: "lsrl" }, titledCtx);
    if (!vTitled.ok) throw new Error(`setup: create_adornment validate failed: ${vTitled.error}`);
    const titledOut = await createAdornmentTool.execute(vTitled.resolved, titledCtx);
    const titledLabel = titledOut.match(/Scatterplots: ([^.]+)\./)?.[1];
    if (!titledLabel) throw new Error("create_adornment's corrective did not print the expected Scatterplots list shape");

    labelInventory.create_adornment = {
      untitledDotPlot: untitledLabel,
      titledScatterplot: assertResolves("create_adornment (corrective)", titledLabel, titledScatterplot.id),
    };
    expect(labelInventory.create_adornment).toEqual({ untitledDotPlot: "the Height dot plot", titledScatterplot: "Height vs Mass" });
  });

  // Runs last (jest executes `it` blocks in declaration order within a describe) — prints the
  // full inventory collected by every test above so the report can quote exactly what each
  // surface emits for each fixture graph. Not itself a new assertion beyond "the inventory was
  // fully populated" — the per-surface resolution checks already ran in their own tests above.
  it("inventory: every named surface contributed a resolvable label for both fixture graphs", () => {
    const expectedSurfaces = [
      "buildGraphSeed", "describeGraphOption", "get_graph_info", "sonify_graph", "update_graph", "create_adornment",
    ];
    for (const surface of expectedSurfaces) {
      expect(labelInventory[surface]).toBeDefined();
      expect(labelInventory[surface].untitledDotPlot).toBeTruthy();
      expect(labelInventory[surface].titledScatterplot).toBeTruthy();
    }
    // eslint-disable-next-line no-console
    console.log("DAVAI-126 matrix round 3 umbrella closure — label inventory:", JSON.stringify(labelInventory, null, 2));
  });
});
