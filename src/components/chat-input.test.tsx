import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ChatInputComponent } from "./chat-input";

describe("test chat input component", () => {
  const mockHandleSubmit = jest.fn();

  it("renders a textarea and submit button that lets user send chat messages", () => {
    render(<ChatInputComponent onSubmit={mockHandleSubmit} onKeyboardShortcut={jest.fn()} />);

    const chatInput = screen.getByTestId("chat-input");
    expect(chatInput).toBeInTheDocument();
    const chatInputLabel = within(chatInput).getByTestId("chat-input-label");
    expect(chatInputLabel).toBeInTheDocument();
    expect(chatInputLabel).toHaveAttribute("for", "chat-input");
    expect(chatInputLabel).toHaveClass("visually-hidden");
    const chatInputTextarea = within(chatInput).getByTestId("chat-input-textarea");
    expect(chatInputTextarea).toBeInTheDocument();
    const chatInputSend = within(chatInput).getByTestId("chat-input-send");
    expect(chatInputSend).toBeInTheDocument();
    // If no message is entered, an error message should appear.
    act(() => chatInputSend.click());
    const inputError = within(chatInput).getByTestId("input-error");
    expect(inputError).toBeInTheDocument();
    expect(inputError).toHaveAttribute("aria-live", "assertive");
    expect(inputError).toHaveTextContent("Please enter a message before sending.");
    expect(mockHandleSubmit).not.toHaveBeenCalled();
    // If message is entered, no error should appear and the message should be submitted.
    chatInputTextarea.focus();
    fireEvent.change(chatInputTextarea, {target: {value: "Hello!"}})
    act(() => chatInputSend.click());
    expect(inputError).not.toBeInTheDocument();
    expect(mockHandleSubmit).toHaveBeenCalled();
  });
});
