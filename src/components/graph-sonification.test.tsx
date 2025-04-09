import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { GraphSonification } from "./graph-sonification";

describe("GraphSonification Component", () => {
  const mockOnSelectGraph = jest.fn();
  const mockAvailableGraphs = [
    { id: "graph1", name: "Graph 1" },
    { id: "graph2", name: "Graph 2" },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the component with default state", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        onSelectGraph={mockOnSelectGraph}
      />
    );

    expect(screen.getByText("Sonification")).toBeInTheDocument();
    expect(screen.getByLabelText("Graph to sonify:")).toBeInTheDocument();
    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
    expect(screen.getByText("Repeat")).toBeInTheDocument();
  });

  it("toggles play and pause state", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        selectedGraph={mockAvailableGraphs[0]}
        onSelectGraph={mockOnSelectGraph}
      />
    );

    const playButton = screen.getByTestId("playback-button");
    fireEvent.click(playButton);
    expect(playButton).toHaveAccessibleName("Pause");
    fireEvent.click(playButton);
    expect(playButton).toHaveAccessibleName("Play");
  });

  it("toggles looping state", () => {
    render(
      <GraphSonification
        availableGraphs={mockAvailableGraphs}
        onSelectGraph={mockOnSelectGraph}
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
        onSelectGraph={mockOnSelectGraph}
      />
    );

    const speedSelect = screen.getByLabelText("Playback Speed");
    fireEvent.change(speedSelect, { target: { value: "1.5" } });

    expect(speedSelect).toHaveValue("1.5");
  });
});