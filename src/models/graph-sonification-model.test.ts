import { types } from "mobx-state-tree";
import { getAllItems, codapInterface } from "@concord-consortium/codap-plugin-api";
import { GraphSonificationModel, GraphSonificationModelType } from "./graph-sonification-model";

const mockAvailableGraphs = [
  { id: 1, name: "Graph 1", plotType: "scatterPlot", dataContext: "context1" },
  { id: 2, name: "Graph 2", plotType: "scatterPlot", dataContext: "context2" },
  { id: 3, name: "Graph 3", plotType: "dotPlot", dataContext: "context3" },
  { id: 4, name: "Graph 4", plotType: "barChart", dataContext: "context4" }
];

const mockGraphItems = [
  { values: { x: 1, y: 2 } },
  { values: { x: 3, y: 4 } },
  { values: { x: 5, y: 6 } }
];

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  getAllItems: jest.fn(() => Promise.resolve({ values: mockGraphItems })),
  codapInterface: {
    sendRequest: jest.fn()
  }
}));

jest.mock("../utils/utils", () => ({
  getGraphDetails: jest.fn(() => Promise.resolve(mockAvailableGraphs)),
  isGraphSonifiable: jest.fn((graph) => graph.plotType === "scatterPlot" || graph.plotType === "dotPlot"),
  sendCODAPRequest: jest.fn(),
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
        sendCODAPDocumentInfo: mockSendCODAPDocumentInfo,
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
    (getAllItems as jest.Mock).mockClear();
    (codapInterface.sendRequest as jest.Mock).mockClear();

    rootStore = RootStore.create({
      sonificationStore: {
        allGraphs: [],
        selectedGraphID: undefined,
        graphItems: undefined,
        binValues: {
          bins: [],
          minBinEdge: 0,
          maxBinEdge: 0,
          binWidth: 0
        }
      },
      assistantStore: {
        isInitialized: true
      }
    });

    store = rootStore.sonificationStore;
  });

  it("should initialize with empty graphs and no selected graph", () => {
    expect(store.allGraphs.length).toBe(0);
    expect(store.selectedGraphID).toBeUndefined();
  });

  it("should set available graphs", async () => {
    await store.setGraphs();
    expect(store.allGraphs.length).toBe(4);
    expect(store.allGraphs[0].id).toBe(1);
    expect(store.allGraphs[1].id).toBe(2);
    expect(store.allGraphs[2].id).toBe(3);
    expect(store.allGraphs[3].id).toBe(4);
  });

  it("should only include scatter plots and dot plots in validGraphs", async () => {
    await store.setGraphs();
    const validGraphs = store.validGraphs;
    expect(validGraphs.length).toBe(3);
    expect(validGraphs.map(g => g.id)).toEqual([1, 2, 3]);
    expect(validGraphs.find(g => g.plotType === "barChart")).toBeUndefined();
  });

  it("should set selected graph and update graph items", async () => {
    await store.setGraphs();
    store.setSelectedGraphID(1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(store.selectedGraphID).toBe(1);
    expect(store.graphItems).toBeDefined();
    expect(store.graphItems?.length).toBe(3);
    expect(getAllItems).toHaveBeenCalledWith("context1");
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
