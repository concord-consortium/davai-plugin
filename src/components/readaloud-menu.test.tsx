import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { AppConfigProvider } from "../contexts/app-config-context";
import { ReadAloudMenu } from "./readaloud-menu";

describe("test read aloud menu component", () => {
  const mockHandleToggle = jest.fn();
  const mockCreateToggleOption = jest.fn().mockImplementation((option: string, optionLabel: string) => {
    return (
      <div className="user-option">
        <label htmlFor={`${option}-toggle`} data-testid={`${option}-toggle-label`}>
          {optionLabel}:
        </label>
        <input
          data-testid={`${option}-toggle`}
          id={`${option}-toggle`}
          type="checkbox"
          role="switch"
          checked={false}
          aria-checked="false"
          onChange={mockHandleToggle}
        />
      </div>
    );
  });

  beforeEach(() => {
    mockHandleToggle.mockClear();
    mockCreateToggleOption.mockClear();
  });

  it("renders a toggle switch to turn readaloud on and off and a select menu to control playback speed", () => {
    render(
      <AppConfigProvider>
        <ReadAloudMenu createToggleOption={mockCreateToggleOption}/>
      </AppConfigProvider>
    );

    const readAloudToggle = screen.getByTestId("readAloudEnabled-toggle");
    expect(readAloudToggle).toHaveAttribute("type", "checkbox");
    expect(readAloudToggle).toHaveAttribute("role", "switch");
    expect(readAloudToggle).toHaveAttribute("aria-checked", "false");
    expect(readAloudToggle).not.toBeChecked();
    fireEvent.click(readAloudToggle);
    expect(mockHandleToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(readAloudToggle);
    expect(mockHandleToggle).toHaveBeenCalledTimes(2);

    const readAloudPlaybackSpeed = screen.getByTestId("readaloud-playback-speed");
    expect(readAloudPlaybackSpeed).toHaveAttribute("id", "readaloud-playback-speed");
    expect(readAloudPlaybackSpeed).toHaveValue("1");
    fireEvent.mouseDown(readAloudPlaybackSpeed);
    const option5 = screen.getByTestId("playback-speed-option-5") as HTMLOptionElement;
    fireEvent.click(option5);
    fireEvent.change(readAloudPlaybackSpeed, { target: { value: "1.5" } });
    expect(readAloudPlaybackSpeed).toHaveValue("1.5");
  });

  it("renders updated labels for Read Responses Aloud", () => {
    render(
      <AppConfigProvider>
        <ReadAloudMenu createToggleOption={mockCreateToggleOption}/>
      </AppConfigProvider>
    );

    // Check section heading
    expect(screen.getByText("Read Responses Aloud")).toBeInTheDocument();

    // Check that toggle was called with new label
    expect(mockCreateToggleOption).toHaveBeenCalledWith("readAloudEnabled", "Read responses aloud", "read-aloud-helper-text");

    // Check speed label
    expect(screen.getByTestId("speed-label")).toHaveTextContent("Playback speed:");
  });

  it("renders 11 speed options from 0.5x to 3x", () => {
    render(
      <AppConfigProvider>
        <ReadAloudMenu createToggleOption={mockCreateToggleOption}/>
      </AppConfigProvider>
    );

    const speedOptions = [
      { testId: "playback-speed-option-1", value: "0.5", label: "0.5x" },
      { testId: "playback-speed-option-2", value: "0.75", label: "0.75x" },
      { testId: "playback-speed-option-3", value: "1", label: "1x" },
      { testId: "playback-speed-option-4", value: "1.25", label: "1.25x" },
      { testId: "playback-speed-option-5", value: "1.5", label: "1.5x" },
      { testId: "playback-speed-option-6", value: "1.75", label: "1.75x" },
      { testId: "playback-speed-option-7", value: "2", label: "2x" },
      { testId: "playback-speed-option-8", value: "2.25", label: "2.25x" },
      { testId: "playback-speed-option-9", value: "2.5", label: "2.5x" },
      { testId: "playback-speed-option-10", value: "2.75", label: "2.75x" },
      { testId: "playback-speed-option-11", value: "3", label: "3x" },
    ];

    speedOptions.forEach(({ testId, value, label }) => {
      const option = screen.getByTestId(testId) as HTMLOptionElement;
      expect(option).toHaveValue(value);
      expect(option).toHaveTextContent(label);
    });
  });

  it("renders helper text about screen reader compatibility", () => {
    render(
      <AppConfigProvider>
        <ReadAloudMenu createToggleOption={mockCreateToggleOption}/>
      </AppConfigProvider>
    );

    const helperText = screen.getByTestId("readaloud-helper-text");
    expect(helperText).toBeInTheDocument();
    expect(helperText).toHaveTextContent("screen reader");
    expect(helperText).toHaveTextContent("Escape");
  });
});
