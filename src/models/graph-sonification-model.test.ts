import { types } from "mobx-state-tree";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { GraphSonificationModel, GraphSonificationModelType } from "./graph-sonification-model";
import { getCollectionItemsForAttributePair, getCollectionItemsForAttribute, getGraphDetails } from "../utils/codap-api-utils";

const mockAvailableGraphs = [
  {
    id: 1, name: "Graph 1", plotType: "scatterPlot", dataContext: "context1",
    yAttributeName: "y", xAttributeName: "x"
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
    (getGraphDetails as jest.Mock).mockClear();
    (getCollectionItemsForAttributePair as jest.Mock).mockClear();
    (getCollectionItemsForAttribute as jest.Mock).mockClear();

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

  it("should re-fetch graph items when attributes change on selected graph", async () => {
    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(getCollectionItemsForAttributePair).toHaveBeenCalledWith(mockDataContext, "x", "y");
    (getCollectionItemsForAttributePair as jest.Mock).mockClear();

    // Simulate attribute change: CODAP reports graph 1 now has yAttributeName "z" instead of "y"
    (getGraphDetails as jest.Mock).mockResolvedValueOnce([
      {
        id: 1, name: "Graph 1", plotType: "scatterPlot", dataContext: "context1",
        yAttributeName: "z", xAttributeName: "x"
      },
      ...mockAvailableGraphs.slice(1)
    ]);
    await store.setGraphs();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(getCollectionItemsForAttributePair).toHaveBeenCalledWith(mockDataContext, "x", "z");
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
});
