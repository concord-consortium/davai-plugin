import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { ReadAloudMenu } from "./readaloud-menu";

describe("test read aloud menu component", () => {
  const mockHandleToggle = jest.fn();
  const mockHandleSelect = jest.fn();

  it("renders a toggle switch to turn readaloud on and off and a select menu to control playback speed", () => {
    render(
      <ReadAloudMenu
        enabled={false}
        onToggle={mockHandleToggle}
        playbackSpeed={1}
        onPlaybackSpeedSelect={mockHandleSelect}
      />
    );

    const readAloudToggle = screen.getByTestId("readaloud-toggle");
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
    const option3 = screen.getByTestId("playback-speed-option-3") as HTMLOptionElement;
    fireEvent.click(option3);
    fireEvent.change(readAloudPlaybackSpeed, { target: { value: "1.5" } });
    expect(mockHandleSelect).toHaveBeenCalled();
    expect(readAloudPlaybackSpeed).toHaveValue("1.5");
  });
});
