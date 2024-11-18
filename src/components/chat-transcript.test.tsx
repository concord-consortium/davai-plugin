import React from "react";
import { render, screen, within } from "@testing-library/react";

import { ChatTranscriptComponent } from "./chat-transcript";

describe("test chat transcript component", () => {
  const chatTranscript = {
    messages: [
      {
        content: "Hello. How can I help you today?",
        speaker: "DAVAI",
        timestamp: "2021-07-01T12:00:00Z"
      },
      {
        content: "Tell me about the data!",
        speaker: "User",
        timestamp: "2021-07-01T12:00:05Z"
      }
    ]
  };

  it("renders a chat transcript that lists all chat messages", () => {
    render(<ChatTranscriptComponent chatTranscript={chatTranscript} />);

    const transcript = screen.getByTestId("chat-transcript");
    expect(transcript).toBeInTheDocument();
    expect(transcript).toHaveAttribute("aria-label", "DAVAI Chat Transcript");
    const messages = within(transcript).getAllByTestId("chat-message");
    expect(messages).toHaveLength(2);

    // note: messages from AI should be assertive, while messages from user will not have aria-live
    expect(messages[0]).toHaveAttribute("aria-live", "assertive");
    expect(messages[1]).not.toHaveAttribute("aria-live");

    messages.forEach((message: HTMLElement, index: number) => {
      const labelContent = `${chatTranscript.messages[index].speaker} at ${chatTranscript.messages[index].timestamp}`;
      expect(message).toHaveAttribute("aria-label", labelContent);

      const speaker = within(message).getByTestId("chat-message-speaker");
      expect(speaker).toBeInTheDocument();
      expect(speaker).toHaveAttribute("aria-label", "speaker");
      expect(speaker).toHaveTextContent(chatTranscript.messages[index].speaker);

      const content = within(message).getByTestId("chat-message-content");
      expect(content).toBeInTheDocument();
      expect(content).toHaveAttribute("aria-label", "message");
      expect(content).toHaveTextContent(chatTranscript.messages[index].content);
    });
  });
});
