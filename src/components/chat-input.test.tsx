import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ChatInputComponent } from "./chat-input";

const mockSpeechRecognition = jest.fn().mockImplementation(() => {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    onresult: jest.fn(),
    continuous: true,
    grammars: {},
    interimResults: false,
    lang: "",
    onaudiostart: null,
    onaudioend: null,
    onend: null,
    onerror: null,
    onnomatch: null,
    onsoundstart: null,
    onspeechend: null,
    onspeechstart: null,
    onstart: null
  };
});

global.SpeechRecognition = jest.fn().mockImplementation(() => new mockSpeechRecognition());

beforeAll(() => {
  global.SpeechRecognition = mockSpeechRecognition;
});

describe("test chat input component", () => {
  const mockHandleSubmit = jest.fn();

  it("renders a textarea and submit button that lets user send chat messages", () => {
    render(<ChatInputComponent keyboardShortcutEnabled={true} shortcutKeys="ctrl+?" onSubmit={mockHandleSubmit} onKeyboardShortcut={jest.fn()} />);

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
    expect(mockHandleSubmit).toHaveBeenCalled();
  });

  it ("renders a dictate button that lets user dictate chat messages", () => {
    render(<ChatInputComponent keyboardShortcutEnabled={true} shortcutKeys="ctrl+?" onSubmit={mockHandleSubmit} onKeyboardShortcut={jest.fn()} />);

    const chatInput = screen.getByTestId("chat-input");
    const chatInputDictate = within(chatInput).getByTestId("chat-input-dictate");
    expect(chatInputDictate).toHaveAttribute("aria-pressed", "false");
    act(() => chatInputDictate.click());
    expect(chatInputDictate).toHaveAttribute("aria-pressed", "true");
    act(() => chatInputDictate.click());
    expect(chatInputDictate).toHaveAttribute("aria-pressed", "false");
  });
});
