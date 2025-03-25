import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";

describe("test keyboard shortcut controls component", () => {
  const defaultShortcut = "ctrl+?";
  const customShortcut = "ctrl+b";

  afterEach(cleanup);

  const WrapperComponent = () => {
    return (
      <KeyboardShortcutControls/>
    );
  };

  it("renders a button for disabling/enabling the keyboard shortcut", () => {
    render(<WrapperComponent />);
    const button = screen.getByTestId("keyboard-shortcut-toggle");
    expect(button).toHaveTextContent("Disable Shortcut");
    fireEvent.click(button);
    expect(button).toHaveTextContent("Enable Shortcut");
    fireEvent.click(button);
    expect(button).toHaveTextContent("Disable Shortcut");
  });

  it("renders a form for customizing the keyboard shortcut", async () => {
    render(<WrapperComponent />);
    const form = screen.getByTestId("custom-keyboard-shortcut-form");
    const input = within(form).getByTestId("custom-keyboard-shortcut");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("custom-keyboard-shortcut-confirmation")).toBeNull();
    const submitButton = within(form).getByTestId("custom-keyboard-shortcut-submit");
    expect(input).toHaveValue(defaultShortcut);
    fireEvent.change(input, {target: {value: customShortcut}});
    fireEvent.click(submitButton);
    expect(input).toHaveValue(customShortcut);
    expect(input).toHaveAttribute("aria-describedby", "custom-keyboard-shortcut-confirmation");
    expect(screen.getByTestId("custom-keyboard-shortcut-confirmation")).toBeInTheDocument();
    const confirmationMsg = screen.getByTestId("custom-keyboard-shortcut-confirmation").textContent;
    expect(confirmationMsg).toContain(`Keyboard shortcut changed to ${customShortcut}`);
    const dismissButton = screen.getByTestId("custom-keyboard-shortcut-confirmation-dismiss");
    expect(dismissButton).toHaveTextContent("dismiss");
  });

  it("shows an error message if the custom keyboard shortcut input is empty", () => {
    render(<WrapperComponent />);
    const form = screen.getByTestId("custom-keyboard-shortcut-form");
    const input = within(form).getByTestId("custom-keyboard-shortcut");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("custom-keyboard-shortcut-error")).toBeNull();
    fireEvent.change(input, {target: {value: ""}});
    const submitButton = within(form).getByTestId("custom-keyboard-shortcut-submit");
    fireEvent.click(submitButton);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "custom-keyboard-shortcut-error");
    expect(screen.getByTestId("custom-keyboard-shortcut-error")).toBeInTheDocument();
    expect(screen.getByTestId("custom-keyboard-shortcut-error")).toHaveTextContent("Please enter a value for the keyboard shortcut.");
  });
});
