import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { GraphSonification } from "./graph-sonification";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { ICODAPGraph } from "../types";

describe("GraphSonification Component", () => {
  const mockAvailableGraphs = [
    { id: "graph1", name: "Graph 1" },
    { id: "graph2", name: "Graph 2" },
  ];

  const mockSonificationStore: Partial<GraphSonificationModelType> = {
    selectedGraph: undefined,
    setSelectedGraph: jest.fn(),
    setGraphItems: jest.fn(),
    getTimeFractions: jest.fn(),
    getTimeValues: jest.fn(),
    getPitchFractions: jest.fn(),
    getPrimaryBounds: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the component with default state", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
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
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
      />
    );

    const playButton = screen.getByTestId("playback-button");
    fireEvent.click(playButton);

    expect(screen.getByText("Please select a graph to sonify.")).toBeInTheDocument();
  });

  it("toggles play and pause state", () => {
    mockSonificationStore.selectedGraph = mockAvailableGraphs[0] as unknown as ICODAPGraph;

    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
      />
    );

    const playButton = screen.getByTestId("playback-button");
    const resetButton = screen.getByTestId("reset-button");

    expect(resetButton).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(playButton);

    expect(playButton).toHaveAccessibleName("Pause");

    fireEvent.click(playButton);

    expect(playButton).toHaveAccessibleName("Play");
    expect(resetButton).toHaveAttribute("aria-disabled", "false");
  });

  it("toggles looping state", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
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
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
      />
    );

    const speedSelect = screen.getByLabelText("Playback Speed");

    expect(speedSelect).toHaveValue("1");

    fireEvent.change(speedSelect, { target: { value: "1.5" } });

    expect(speedSelect).toHaveValue("1.5");
  });

  it("updates looping state in useEffect", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
      />
    );

    const repeatButton = screen.getByTestId("repeat-button");
    fireEvent.click(repeatButton);

    expect(repeatButton).toHaveAttribute("aria-checked", "true");
  });

  it("updates duration based on speed in useEffect", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        sonificationStore={mockSonificationStore as GraphSonificationModelType}
      />
    );

    const speedSelect = screen.getByLabelText("Playback Speed");
    fireEvent.change(speedSelect, { target: { value: "2" } });

    expect(speedSelect).toHaveValue("2");
  });
});
