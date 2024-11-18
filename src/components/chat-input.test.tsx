import React from "react";
import { act, render, screen, within } from "@testing-library/react";

import { ChatInputComponent } from "./chat-input";

describe("test chat input component", () => {
  const mockHandleSubmit = jest.fn();

  it("renders a textarea and submit button that lets user send chat messages", () => {
    render(<ChatInputComponent onSubmit={mockHandleSubmit} />);

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
    act(() => chatInputSend.click());
    expect(mockHandleSubmit).toHaveBeenCalled();
  });
});
