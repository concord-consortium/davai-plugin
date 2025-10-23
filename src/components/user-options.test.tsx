import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserOptions } from "./user-options";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../contexts/app-config-context";

jest.mock("../contexts/app-config-context", () => ({
  useAppConfigContext: jest.fn(),
}));

jest.mock("./readaloud-menu", () => ({
  ReadAloudMenu: ({ createToggleOption }: any) => (
    <div data-testid="readaloud-menu">
      {createToggleOption("mockOption", "Mock Option")}
    </div>
  ),
}));

jest.mock("./keyboard-shortcut-controls", () => ({
  KeyboardShortcutControls: () => <div data-testid="keyboard-shortcut-controls" />,
}));

jest.mock("./developer-options", () => ({
  DeveloperOptionsComponent: ({ createToggleOption }: any) => (
    <div data-testid="developer-options">
      {createToggleOption("mockDevOption", "Mock Dev Option")}
    </div>
  ),
}));

describe("UserOptions Component", () => {
  const mockToggleOption = jest.fn();
  const mockAssistantStore = {} as AssistantModelType;

  beforeEach(() => {
    (useAppConfigContext as jest.Mock).mockReturnValue({    
      playProcessingMessage: true,
      playProcessingTone: false,
      toggleOption: mockToggleOption,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders the component with all sections", () => {
    render(<UserOptions assistantStore={mockAssistantStore} onInitializeAssistant={jest.fn()} />);

    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByText("Loading Indicators")).toBeInTheDocument();
    expect(screen.getByTestId("readaloud-menu")).toBeInTheDocument();
    expect(screen.getByTestId("keyboard-shortcut-controls")).toBeInTheDocument();
    expect(screen.getByTestId("developer-options")).toBeInTheDocument();
  });

  it("renders toggle options with correct labels and states", () => {
    render(<UserOptions assistantStore={mockAssistantStore} onInitializeAssistant={jest.fn()} />);

    const playMessageToggle = screen.getByTestId("playProcessingMessage-toggle");
    const playToneToggle = screen.getByTestId("playProcessingTone-toggle");

    expect(screen.getByTestId("playProcessingMessage-toggle-label")).toHaveTextContent("Play loading message:");
    expect(playMessageToggle).toBeChecked();

    expect(screen.getByTestId("playProcessingTone-toggle-label")).toHaveTextContent("Play loading tone:");
    expect(playToneToggle).not.toBeChecked();
  });

  it("calls toggleOption when a toggle is clicked", () => {
    render(<UserOptions assistantStore={mockAssistantStore} onInitializeAssistant={jest.fn()} />);

    const playMessageToggle = screen.getByTestId("playProcessingMessage-toggle");
    fireEvent.click(playMessageToggle);

    expect(mockToggleOption).toHaveBeenCalledWith("playProcessingMessage");

    const playToneToggle = screen.getByTestId("playProcessingTone-toggle");
    fireEvent.click(playToneToggle);

    expect(mockToggleOption).toHaveBeenCalledWith("playProcessingTone");
  });
});
