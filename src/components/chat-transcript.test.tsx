import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AppConfigProvider } from "../contexts/app-config-context";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ShortcutsServiceProvider } from "../contexts/shortcuts-service-context";

describe("test chat transcript component", () => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  const chatTranscript = {
    messages: [
      {
        messageContent: {content: "Hello. How can I help you today?"},
        speaker: "DAVAI",
        timestamp: "2021-07-01T12:00:00Z",
        id: "1",
        plainTextContent: "Hello. How can I help you today?"
      },
      {
        messageContent: {content: "Tell me about the data!"},
        speaker: "User",
        timestamp: "2021-07-01T12:00:05Z",
        id: "2",
        plainTextContent: "Tell me about the data!"
      }
    ]
  };

  it("renders a chat transcript that lists all chat messages", () => {
    render(
      <AppConfigProvider>
        <ShortcutsServiceProvider>
          <ChatTranscriptComponent chatTranscript={chatTranscript}/>
        </ShortcutsServiceProvider>
      </AppConfigProvider>
    );

    const transcript = screen.getByTestId("chat-transcript");
    const messages = within(transcript).getAllByTestId("chat-message");
    expect(messages).toHaveLength(2);

    messages.forEach((message: HTMLElement, index: number) => {
      const labelContent = chatTranscript.messages[index].speaker;
      expect(message).toHaveAttribute("aria-label", labelContent);

      const speaker = within(message).getByTestId("chat-message-speaker");
      expect(speaker).toHaveTextContent(chatTranscript.messages[index].speaker);

      const content = within(message).getByTestId("chat-message-content");
      expect(content).toHaveTextContent(chatTranscript.messages[index].messageContent.content);
    });
  });

  it("copies the transcript and downloads it when the capture button is clicked", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    (global.URL as any).createObjectURL = jest.fn(() => "blob:url");
    (global.URL as any).revokeObjectURL = jest.fn();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(
      <AppConfigProvider>
        <ShortcutsServiceProvider>
          <ChatTranscriptComponent chatTranscript={chatTranscript}/>
        </ShortcutsServiceProvider>
      </AppConfigProvider>
    );

    fireEvent.click(screen.getByTestId("capture-transcript-button"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0][0] as string;
    expect(copiedText).toContain("DAVAI Chat Transcript");
    expect(copiedText).toContain("Hello. How can I help you today?");

    clickSpy.mockRestore();
  });
});
