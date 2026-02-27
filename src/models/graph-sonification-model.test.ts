import { types } from "mobx-state-tree";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { GraphSonificationModel, GraphSonificationModelType } from "./graph-sonification-model";
import {
  getCollectionItemsForAttributePair, getCollectionItemsForAttribute, getSelectionList
} from "../utils/codap-api-utils";

const mockAvailableGraphs = [
  {
    id: 1, name: "Graph 1", plotType: "scatterPlot", dataContext: "context1",
    yAttributeName: "y", xAttributeName: "x",
    xLowerBound: 0, xUpperBound: 10, yLowerBound: 0, yUpperBound: 10
  },
  {
    id: 2, name: "Graph 2", plotType: "scatterPlot", dataContext: "context2",
    yAttributeName: "y", xAttributeName: "x"
  },
  {
    id: 3, name: "Graph 3", plotType: "dotPlot", dataContext: "context3",
    xAttributeName: "x"
  },
  {
    id: 4, name: "Graph 4", plotType: "barChart", dataContext: "context4"
  }
];

const mockGraphItemsScatterPlot = [
  { values: { x: 1, y: 2 } },
  { values: { x: 3, y: 4 } },
  { values: { x: 5, y: 6 } }
];

const mockGraphItemsDotPlot = [
  { values: { x: 1 } },
  { values: { x: 3 } },
  { values: { x: 5 } }
];

const mockGraphItemsWithIds = [
  { id: "10", values: { x: 1, y: 2 } },
  { id: "20", values: { x: 3, y: 4 } },
  { id: "30", values: { x: 5, y: 6 } }
];

const mockDataContext = {
  collections: [
    { name: "collection0" },
    { name: "collection1" }
  ]
};

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  codapInterface: {
    sendRequest: jest.fn(),

  },
  getDataContext: jest.fn((name: string) => {
    return Promise.resolve({
      values: mockDataContext
    });
  })
}));

jest.mock("../utils/codap-api-utils", () => ({
  getGraphDetails: jest.fn(() => Promise.resolve(mockAvailableGraphs)),
  getCollectionItemsForAttributePair: jest.fn(() => Promise.resolve(mockGraphItemsScatterPlot)),
  getCollectionItemsForAttribute: jest.fn(() => Promise.resolve(mockGraphItemsDotPlot)),
  trimDataset: jest.fn((dataContext: any) => dataContext),
  getGraphAdornments: jest.fn(() => Promise.resolve([])),
  getSelectionList: jest.fn(() => Promise.resolve([])),
}));

jest.mock("../utils/graph-sonification-utils", () => ({
  isGraphSonifiable: jest.fn((graph) => graph.plotType === "scatterPlot" || graph.plotType === "dotPlot"),
  removeRoiAdornment: jest.fn(),
}));


const mockSendCODAPDocumentInfo = jest.fn();
const mockSetAssistantState = jest.fn();
const mockGetAssistantState = jest.fn(() => ({ isAssistantEnabled: false }));

const RootStore = types
  .model("RootStore", {
    sonificationStore: GraphSonificationModel,
    assistantStore: types.model("AssistantStore", {
      isInitialized: types.optional(types.boolean, false)
    })
  })
  .actions((self) => ({
    afterCreate() {
      Object.assign(self.assistantStore, {
        processAndSendCODAPDocumentInfo: mockSendCODAPDocumentInfo,
        setAssistantState: mockSetAssistantState,
        getAssistantState: mockGetAssistantState
      });
    }
  }));

describe("GraphSonificationModel", () => {
  let rootStore: ReturnType<typeof RootStore.create>;
  let store: GraphSonificationModelType;

  beforeEach(() => {
    mockSendCODAPDocumentInfo.mockClear();
    mockSetAssistantState.mockClear();
    mockGetAssistantState.mockClear();
    (codapInterface.sendRequest as jest.Mock).mockClear();
    (getSelectionList as jest.Mock).mockReset();
    (getSelectionList as jest.Mock).mockResolvedValue([]);

    rootStore = RootStore.create({
      sonificationStore: {
        allGraphs: {},
        selectedGraphID: undefined,
        graphItems: undefined,
        binValues: {
          bins: [],
          minBinEdge: 0,
          maxBinEdge: 0,
          binWidth: 0,
          values: []
        }
      },
      assistantStore: {
        isInitialized: true
      }
    });

    store = rootStore.sonificationStore;
  });

  it("should initialize with empty graphs and no selected graph", () => {
    expect(store.allGraphs.size).toBe(0);
    expect(store.selectedGraphID).toBeUndefined();
  });

  it("should set available graphs", async () => {
    await store.setGraphs();
    expect(store.allGraphs.size).toBe(4);
    expect(store.allGraphs.get("1")).toBeDefined();
    expect(store.allGraphs.get("2")).toBeDefined();
    expect(store.allGraphs.get("3")).toBeDefined();
    expect(store.allGraphs.get("4")).toBeDefined();
  });

  it("should only include scatter plots and dot plots in validGraphs", async () => {
    await store.setGraphs();
    const validGraphs = store.validGraphs;
    expect(validGraphs.length).toBe(3);
    expect(validGraphs.map(g => g.id)).toEqual([1, 2, 3]);
    expect(validGraphs.find(g => g.plotType === "barChart")).toBeUndefined();
  });

  it("should set selected graph and update graph items for scatter plot", async () => {
    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(store.selectedGraphID).toBe(1);
    expect(store.graphItems).toBeDefined();
    expect(store.graphItems?.length).toBe(3);
    expect(getCollectionItemsForAttributePair).toHaveBeenCalledWith(mockDataContext, "x", "y");
  });

  it("should set selected graph and update graph items for dot plot", async () => {
    await store.setGraphs();
    store.setSelectedGraphID(3);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(store.selectedGraphID).toBe(3);
    expect(store.graphItems).toBeDefined();
    expect(store.graphItems?.length).toBe(3);
    expect(getCollectionItemsForAttribute).toHaveBeenCalledWith(mockDataContext, "x");
  });

  it("should only allow selecting sonifiable graphs", async () => {
    await store.setGraphs();
    // Graph 1 is sonifiable (scatterPlot)
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(store.selectedGraphID).toBe(1);

    // Try to select a non-sonifiable graph
    store.setSelectedGraphID(999);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(store.selectedGraphID).toBeUndefined();
  });

  it("should initialize with empty selectedCaseIds", () => {
    expect(store.selectedCaseIds).toEqual([]);
  });

  it("should fetch and store selection for the selected graph's data context", async () => {
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" },
      { caseID: 20, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(getSelectionList).toHaveBeenCalledWith("context1");
    expect(store.selectedCaseIds).toEqual([10, 20]);
  });

  it("should clear selection when clearSelection is called", async () => {
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(store.selectedCaseIds).toEqual([10]);

    store.clearSelection();
    expect(store.selectedCaseIds).toEqual([]);
  });

  it("should return all validItems when nothing is selected", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(mockGraphItemsWithIds);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(store.selectedCaseIds).toEqual([]);
    expect(store.validItems.length).toBe(3);
  });

  it("should filter validItems to only selected cases", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(mockGraphItemsWithIds);
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" },
      { caseID: 30, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(store.validItems.length).toBe(2);
    expect(store.validItems[0].id).toBe("10");
    expect(store.validItems[1].id).toBe("30");
  });

  it("should handle hierarchical item IDs when filtering by selection", async () => {
    const hierarchicalItems = [
      { id: "100/10", values: { x: 1, y: 2 } },
      { id: "100/20", values: { x: 3, y: 4 } },
      { id: "200/30", values: { x: 5, y: 6 } }
    ];
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(hierarchicalItems);
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" },
      { caseID: 30, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(store.validItems.length).toBe(2);
    expect(store.validItems[0].id).toBe("100/10");
    expect(store.validItems[1].id).toBe("200/30");
  });

  it("should use axis bounds for sonificationPrimaryBounds when nothing is selected", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(mockGraphItemsWithIds);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    // When nothing is selected, sonificationPrimaryBounds should equal primaryBounds
    // (the full axis range). The scheduler pads bins with zeros to cover the axis range,
    // so the continual tone is silent in leading/trailing space.
    expect(store.sonificationPrimaryBounds).toEqual(store.primaryBounds);
  });

  it("should compute sonificationPrimaryBounds with 2% padding from axis range", async () => {
    // Use graphs with explicit axis bounds so padding is visible
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(mockGraphItemsWithIds);
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" },
      { caseID: 30, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Selected items have x (time) values of 1 and 5
    // Axis range is 0-10, so padding = (10 - 0) * 0.02 = 0.2
    // lowerBound = max(1 - 0.2, 0) = 0.8
    // upperBound = min(5 + 0.2, 10) = 5.2
    const bounds = store.sonificationPrimaryBounds;
    expect(bounds.lowerBound).toBeCloseTo(0.8);
    expect(bounds.upperBound).toBeCloseTo(5.2);
  });

  it("should clamp sonificationPrimaryBounds padding to axis edges", async () => {
    // Use graphs with axis bounds, select items near the axis edge
    // Items at x=0 and x=10 — right at the axis edges
    const edgeItems = [
      { id: "10", values: { x: 0, y: 2 } },
      { id: "20", values: { x: 10, y: 8 } }
    ];
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(edgeItems);
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" },
      { caseID: 20, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    // padding = (10 - 0) * 0.02 = 0.2
    // lowerBound = max(0 - 0.2, 0) = 0 (clamped to axis)
    // upperBound = min(10 + 0.2, 10) = 10 (clamped to axis)
    const bounds = store.sonificationPrimaryBounds;
    expect(bounds.lowerBound).toBe(0);
    expect(bounds.upperBound).toBe(10);
  });

  it("should handle sonificationPrimaryBounds with a single selected point", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValueOnce(mockGraphItemsWithIds);
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 20, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Single selected item at x=3, dataMin === dataMax === 3
    // padding = (10 - 0) * 0.02 = 0.2
    // lowerBound = max(3 - 0.2, 0) = 2.8
    // upperBound = min(3 + 0.2, 10) = 3.2
    const bounds = store.sonificationPrimaryBounds;
    expect(bounds.lowerBound).toBeCloseTo(2.8);
    expect(bounds.upperBound).toBeCloseTo(3.2);
  });

  it("should clear selection when graph is deselected", async () => {
    (getSelectionList as jest.Mock).mockResolvedValue([
      { caseID: 10, collectionID: 5, collectionName: "Cases" }
    ]);

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(store.selectedCaseIds).toEqual([10]);

    // Deselect the graph — selection should be cleared when graph is deselected
    store.setSelectedGraphID(undefined);
    expect(store.selectedCaseIds).toEqual([]);
  });

  it("should handle fetchSelection errors gracefully", async () => {
    (getSelectionList as jest.Mock).mockRejectedValue(new Error("Network error"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(store.selectedCaseIds).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("Failed to fetch selection list:", expect.any(Error));
    warnSpy.mockRestore();
  });
});
