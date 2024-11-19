import React from "react";
import { act, render, screen, within } from "@testing-library/react";

import { ReadAloudMenu } from "./readaloud-menu";

describe("test read aloud menu component", () => {
  const mockHandleToggle = jest.fn();
  const mockHandleSelect = jest.fn();

  beforeEach(() => {
    mockHandleToggle.mockClear();
    mockHandleSelect.mockClear();
    render(
      <ReadAloudMenu
        enabled={false}
        onToggle={mockHandleToggle}
        playbackSpeed={1}
        onPlaybackSpeedSelect={mockHandleSelect}
      />
    );
  });

  it("renders a toggle switch that lets a user turn read-aloud mode on and off", () => {
    const readAloudMenu = screen.getByRole("menu");
    expect(readAloudMenu).toBeInTheDocument();
    const readAloudToggle = screen.getByTestId("readaloud-toggle");
    expect(readAloudToggle).toBeInTheDocument();
    expect(readAloudToggle).toHaveAttribute("type", "checkbox");
    expect(readAloudToggle).toHaveAttribute("role", "switch");
    expect(readAloudToggle).toHaveAttribute("aria-checked", "false");
    expect(readAloudToggle).not.toBeChecked();
    act(() => readAloudToggle.click());
    expect(mockHandleToggle).toHaveBeenCalledTimes(1);
    act(() => readAloudToggle.click());
    expect(mockHandleToggle).toHaveBeenCalledTimes(2);
  });

  it("renders a select dropdown that allows a user to select the playback speed of the readaloud", () => {
    const readAloudPlaybackSpeed = screen.getByTestId("readaloud-playback-speed");
    expect(readAloudPlaybackSpeed).toBeInTheDocument();
    expect(readAloudPlaybackSpeed).toHaveAttribute("id", "readaloud-playback-speed");
    expect(readAloudPlaybackSpeed).toHaveValue("1");
    act(() => {
      readAloudPlaybackSpeed.click();
      const option3 = screen.getByTestId("playback-speed-option-3") as HTMLOptionElement;
      expect(option3).toHaveValue("1.5");
      option3.selected = true;
      readAloudPlaybackSpeed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mockHandleSelect).toHaveBeenCalled();
    expect(readAloudPlaybackSpeed).toHaveValue("1.5");
  });

  it("renders all playback speed options correctly", () => {
    const readAloudPlaybackSpeed = screen.getByTestId("readaloud-playback-speed");
    expect(readAloudPlaybackSpeed).toBeInTheDocument();
    const options = within(readAloudPlaybackSpeed).getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveValue("0.5");
    expect(options[1]).toHaveValue("1");
    expect(options[2]).toHaveValue("1.5");
    expect(options[3]).toHaveValue("2");
  });

});