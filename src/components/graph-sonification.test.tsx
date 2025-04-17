import React from "react";
import { types } from "mobx-state-tree";
import { render, fireEvent, screen } from "@testing-library/react";
import { GraphSonification } from "./graph-sonification";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { ICODAPGraph } from "../types";

const mockSonificationModel = types
.model("GraphSonificationModel", {
  allGraphs: types.optional(types.array(types.frozen<Partial<ICODAPGraph>>()), []),
  selectedGraphID: types.maybe(types.number),
  graphItems: types.maybe(types.array(types.frozen()))
})
.views((self) => ({
  get validGraphs() {
    return self.allGraphs?.filter((graph: Partial<ICODAPGraph>) => graph.plotType === "scatterPlot") || [];
  }
}))
.views((self) => ({
  get selectedGraph() {
    return self.validGraphs.find((graph: Partial<ICODAPGraph>) => graph.id === self.selectedGraphID);
  }
}))
.actions((self) => ({
  setGraphs(graphs: ICODAPGraph[]) {
    self.allGraphs.replace(graphs);
  },
  setSelectedGraphID(graphID: number) {
    self.selectedGraphID = graphID;
  },
  setGraphItems() {
    return [];
  },
  removeSelectedGraphID() {
    self.selectedGraphID = undefined;
  }
}));

describe("GraphSonification Component", () => {
  const mockAvailableGraphs = [
    { id: 1, name: "Graph 1", plotType: "scatterPlot" },
    { id: 2, name: "Graph 2", plotType: "scatterPlot" },
    { id: 3, name: "Graph 3", plotType: "dotPlot"}
  ];

  const mockSonificationStore = mockSonificationModel.create({
    allGraphs: mockAvailableGraphs,
    selectedGraphID: undefined
  }) as unknown as GraphSonificationModelType;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSonificationStore.removeSelectedGraphID();
    mockSonificationStore.setGraphs(mockAvailableGraphs);
  });

  it("renders the component with default state", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    expect(screen.getByText("Sonification")).toBeInTheDocument();
    expect(screen.getByLabelText("Graph to sonify:")).toBeInTheDocument();
    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
    expect(screen.getByText("Repeat")).toBeInTheDocument();
    expect(screen.getByLabelText("Playback Speed")).toBeInTheDocument();
  });

  it("shows an error message when no graph is selected", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    const playButton = screen.getByTestId("playback-button");
    fireEvent.click(playButton);

    expect(screen.getByText("Please select a graph to sonify.")).toBeInTheDocument();
  });

  it("toggles play and pause state", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    const graphSelect = screen.getByLabelText("Graph to sonify:");
    fireEvent.change(graphSelect, { target: { value: 1 } });
    const resetButton = screen.getByTestId("reset-button");
    expect(resetButton).toHaveAttribute("aria-disabled", "true");
    const playButton = screen.getByTestId("playback-button");
    fireEvent.click(playButton);
    expect(playButton).toHaveAccessibleName("Pause");
  });

  it("toggles looping state", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    const repeatButton = screen.getByTestId("repeat-button");
    fireEvent.click(repeatButton);

    expect(repeatButton).toHaveAttribute("aria-checked", "true");

    fireEvent.click(repeatButton);
    expect(repeatButton).toHaveAttribute("aria-checked", "false");
  });

  it("changes playback speed", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    const speedSelect = screen.getByLabelText("Playback Speed");
    expect(speedSelect).toHaveValue("1");
    fireEvent.change(speedSelect, { target: { value: "1.5" } });
    expect(speedSelect).toHaveValue("1.5");
  });

  it("allows a user to select from valid graphs", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    const graphSelect = screen.getByLabelText("Graph to sonify:");
    expect(graphSelect).toHaveValue("");
    expect(graphSelect).toHaveTextContent("Graph 1");
    expect(graphSelect).toHaveTextContent("Graph 2");
    expect(graphSelect).not.toHaveTextContent("Graph 3");
  });

  it("changes the selected graph", () => {
    render(
      <GraphSonification
        sonificationStore={mockSonificationStore}
      />
    );

    const graphSelect = screen.getByLabelText("Graph to sonify:");
    expect(graphSelect).toHaveValue("");
    expect(mockSonificationStore.selectedGraphID).toBeUndefined();

    fireEvent.change(graphSelect, { target: { value: 1 } });
    expect(graphSelect).toHaveValue("1");
    expect(mockSonificationStore.selectedGraphID).toBe(1);

    fireEvent.change(graphSelect, { target: { value: 2 } });
    expect(graphSelect).toHaveValue("2");
    expect(mockSonificationStore.selectedGraphID).toBe(2);
  });
});
