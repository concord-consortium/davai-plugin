import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

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

  it("renders a toggle switch to turn readaloud on and off and a select menu to control playback speed", () => {
    render(
      <ReadAloudMenu createToggleOption={mockCreateToggleOption}/>
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
    const option3 = screen.getByTestId("playback-speed-option-3") as HTMLOptionElement;
    fireEvent.click(option3);
    fireEvent.change(readAloudPlaybackSpeed, { target: { value: "1.5" } });
    expect(readAloudPlaybackSpeed).toHaveValue("1.5");
  });
});
