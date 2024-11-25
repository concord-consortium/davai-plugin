import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ChatInputComponent } from "./chat-input";

describe("test chat input component", () => {
  const mockHandleSubmit = jest.fn();

  it("renders a textarea and submit button that lets user send chat messages", () => {
    render(<ChatInputComponent keyboardShortcutEnabled={true} onSubmit={mockHandleSubmit} onKeyboardShortcut={jest.fn()} />);

    const chatInput = screen.getByTestId("chat-input");
    const chatInputLabel = within(chatInput).getByTestId("chat-input-label");
    expect(chatInputLabel).toHaveAttribute("for", "chat-input");
    expect(chatInputLabel).toHaveClass("visually-hidden");
    const chatInputTextarea = within(chatInput).getByTestId("chat-input-textarea");
    expect(chatInputTextarea).not.toHaveAttribute("aria-describedby");
    expect(chatInputTextarea).toHaveAttribute("aria-invalid", "false");
    expect(chatInputTextarea).toHaveAttribute("placeholder", "Ask DAVAI about the data");
    const chatInputSend = within(chatInput).getByTestId("chat-input-send");
    // If no message is entered, an error message should appear.
    act(() => chatInputSend.click());
    const inputError = within(chatInput).getByTestId("input-error");
    expect(inputError).toHaveAttribute("aria-live", "assertive");
    expect(inputError).toHaveTextContent("Please enter a message before sending.");
    expect(chatInputTextarea).toHaveAttribute("aria-describedby", "input-error");
    expect(chatInputTextarea).toHaveAttribute("aria-invalid", "true");
    expect(mockHandleSubmit).not.toHaveBeenCalled();
    // If message is entered, no error should appear and the message should be submitted.
    chatInputTextarea.focus();
    fireEvent.change(chatInputTextarea, {target: {value: "Hello!"}});
    act(() => chatInputSend.click());
    expect(inputError).not.toBeInTheDocument();
    expect(chatInputTextarea).not.toHaveAttribute("aria-describedby");
    expect(chatInputTextarea).toHaveAttribute("aria-invalid", "false");
    expect(chatInputTextarea).not.toHaveAttribute("placeholder", "Ask DAVAI about the data");
    expect(mockHandleSubmit).toHaveBeenCalled();
  });
});
