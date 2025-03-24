import React from "react";
import { render, screen, within } from "@testing-library/react";

import { ChatTranscriptComponent } from "./chat-transcript";

describe("test chat transcript component", () => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  const chatTranscript = {
    messages: [
      {
        messageContent: {content: "Hello. How can I help you today?"},
        speaker: "DAVAI",
        timestamp: "2021-07-01T12:00:00Z",
        id: "1"
      },
      {
        messageContent: {content: "Tell me about the data!"},
        speaker: "User",
        timestamp: "2021-07-01T12:00:05Z",
        id: "2"
      }
    ]
  };

  it("renders a chat transcript that lists all chat messages", () => {
    render(<ChatTranscriptComponent chatTranscript={chatTranscript} showDebugLog={false}/>);

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
});
