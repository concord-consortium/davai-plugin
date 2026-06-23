import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AppConfigProvider } from "../contexts/app-config-context";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";

describe("test keyboard shortcut controls component", () => {
  const customShortcut = "Control+b";
  const shortcutRows = [
    { key: "focusChatInput", description: "Focus the chat input", value: "Control+Shift+Slash" },
    { key: "replayLastDavaiMessage", description: "Replay the last DAVAI message", value: "Control+Shift+Comma" },
    { key: "sonifyGraph", description: "Play the graph sonification", value: "Control+Shift+Period" },
    { key: "captureTranscript", description: "Capture the chat transcript", value: "Control+Shift+Semicolon" },
  ];

  afterEach(cleanup);

  const WrapperComponent = () => (
    <AppConfigProvider>
      <KeyboardShortcutControls/>
    </AppConfigProvider>
  );

  it("renders a button for disabling/enabling the keyboard shortcuts", () => {
    render(<WrapperComponent />);
    const button = screen.getByTestId("keyboard-shortcut-toggle");
    expect(button).toHaveTextContent("Disable Shortcut");
    fireEvent.click(button);
    expect(button).toHaveTextContent("Enable Shortcut");
    fireEvent.click(button);
    expect(button).toHaveTextContent("Disable Shortcut");
  });

  it("renders a labeled customize form for every shortcut", () => {
    render(<WrapperComponent />);
    shortcutRows.forEach(({ key, description, value }) => {
      const form = screen.getByTestId(`custom-keyboard-shortcut-${key}-form`);
      expect(within(form).getByText(`${description}:`)).toBeInTheDocument();
      expect(within(form).getByTestId(`custom-keyboard-shortcut-${key}`)).toHaveValue(value);
    });
  });

  it("customizes a single shortcut and shows that row's confirmation", () => {
    render(<WrapperComponent />);
    const form = screen.getByTestId("custom-keyboard-shortcut-focusChatInput-form");
    const input = within(form).getByTestId("custom-keyboard-shortcut-focusChatInput");
    fireEvent.change(input, {target: {value: customShortcut}});
    fireEvent.click(within(form).getByTestId("custom-keyboard-shortcut-focusChatInput-submit"));

    expect(input).toHaveValue(customShortcut);
    expect(input).toHaveAttribute("aria-describedby", "custom-keyboard-shortcut-focusChatInput-confirmation");
    const confirmation = screen.getByTestId("custom-keyboard-shortcut-focusChatInput-confirmation");
    expect(confirmation).toHaveTextContent(`Focus the chat input shortcut changed to ${customShortcut}`);

    // other rows are unaffected
    expect(screen.queryByTestId("custom-keyboard-shortcut-sonifyGraph-confirmation")).toBeNull();
  });

  it("shows an error message when a shortcut input is emptied", () => {
    render(<WrapperComponent />);
    const form = screen.getByTestId("custom-keyboard-shortcut-sonifyGraph-form");
    const input = within(form).getByTestId("custom-keyboard-shortcut-sonifyGraph");
    fireEvent.change(input, {target: {value: ""}});
    fireEvent.click(within(form).getByTestId("custom-keyboard-shortcut-sonifyGraph-submit"));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "custom-keyboard-shortcut-sonifyGraph-error");
    expect(screen.getByTestId("custom-keyboard-shortcut-sonifyGraph-error"))
      .toHaveTextContent("Please enter a value for the keyboard shortcut.");
  });
});
