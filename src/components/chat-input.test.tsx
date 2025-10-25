import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { ChatInputComponent } from "./chat-input";
import { AppConfigProvider } from "../contexts/app-config-context";
import { ShortcutsServiceProvider } from "../contexts/shortcuts-service-context";

const originalSpeechRecognition = global.SpeechRecognition;
const mockSpeechRecognition = jest.fn().mockImplementation(() => ({
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
}));

jest.mock("../utils/utils", () => {
  return {
    ...jest.requireActual("../utils/utils"),
    playSound: jest.fn()
  };
});

beforeAll(() => {
  global.SpeechRecognition = mockSpeechRecognition;
});

afterAll(() => {
  global.SpeechRecognition = originalSpeechRecognition;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("test chat input component", () => {
  const mockHandleSubmit = jest.fn();
  const mockHandleCancel = jest.fn();

  it("renders a textarea and submit button that lets user send chat messages", () => {
    render(
      <AppConfigProvider>
        <ShortcutsServiceProvider>
          <ChatInputComponent onCancel={mockHandleCancel} onSubmit={mockHandleSubmit} />
        </ShortcutsServiceProvider>
      </AppConfigProvider>
    );

    const chatInput = screen.getByTestId("chat-input");
    expect(chatInput).toHaveClass("has-focus");
    const chatInputLabel = within(chatInput).getByTestId("chat-input-label");
    expect(chatInputLabel).toHaveAttribute("for", "chat-input");
    expect(chatInputLabel).toHaveClass("visually-hidden");
    const chatInputTextarea = within(chatInput).getByTestId("chat-input-textarea");
    expect(chatInputTextarea).not.toHaveAttribute("aria-describedby");
    expect(chatInputTextarea).toHaveAttribute("aria-invalid", "false");
    expect(chatInputTextarea).toHaveAttribute("placeholder", "Ask DAVAI about the data");
    const chatInputSend = within(chatInput).getByTestId("chat-input-send");
    // If no message is entered, an error message should appear.
    fireEvent.click(chatInputSend);
    const inputError = within(chatInput).getByTestId("input-error");
    expect(inputError).toHaveTextContent("Please enter a message before sending.");
    expect(chatInputTextarea).toHaveAttribute("aria-describedby", "input-error");
    expect(chatInputTextarea).toHaveAttribute("aria-invalid", "true");
    expect(mockHandleSubmit).not.toHaveBeenCalled();
    // If message is entered, no error should appear and the message should be submitted.
    chatInputTextarea.focus();
    fireEvent.change(chatInputTextarea, {target: {value: "Hello!"}});
    fireEvent.click(chatInputSend);
    expect(inputError).not.toBeInTheDocument();
    expect(chatInputTextarea).not.toHaveAttribute("aria-describedby");
    expect(chatInputTextarea).toHaveAttribute("aria-invalid", "false");
    expect(mockHandleSubmit).toHaveBeenCalled();
  });

  it ("renders a dictate button that lets user dictate chat messages", () => {
    render(
      <AppConfigProvider>
        <ShortcutsServiceProvider>
          <ChatInputComponent onCancel={mockHandleCancel} onSubmit={mockHandleSubmit} />
        </ShortcutsServiceProvider>
      </AppConfigProvider>
    );

    const chatInput = screen.getByTestId("chat-input");
    const chatInputDictate = within(chatInput).getByTestId("chat-input-dictate");
    expect(chatInputDictate).toHaveAccessibleName("Start Dictation");
    expect(chatInputDictate).not.toHaveClass("active");
    fireEvent.click(chatInputDictate);
    expect(chatInputDictate).toHaveAccessibleName("Stop Dictation");
    expect(chatInputDictate).toHaveClass("active");
    expect(global.SpeechRecognition).toHaveBeenCalled();
    const srInstance1 = mockSpeechRecognition.mock.results[0].value;
    expect(srInstance1.start).toHaveBeenCalled();
    fireEvent.click(chatInputDictate);
    expect(chatInputDictate).toHaveAccessibleName("Start Dictation");
    expect(chatInputDictate).not.toHaveClass("active");
    const srInstance2 = mockSpeechRecognition.mock.results[0].value;
    expect(srInstance2.stop).toHaveBeenCalled();
  });
});
