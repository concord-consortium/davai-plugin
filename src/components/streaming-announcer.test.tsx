import React from "react";
import { render } from "@testing-library/react";
import { StreamingAnnouncer } from "./streaming-announcer";
import { SpeechServiceContext } from "../contexts/speech-service-context";
import { ChatTranscriptModel } from "../models/chat-transcript-model";

const provider = (t: any, enqueue: jest.Mock) => (
  <SpeechServiceContext.Provider value={{ speechService: { enqueue } as any, isSpeaking: false, currentSpeechText: null }}>
    <StreamingAnnouncer transcript={t} />
  </SpeechServiceContext.Provider>
);

it("enqueues each completed sentence as the streaming message grows", () => {
  const t = ChatTranscriptModel.create({ messages: [] });
  const enqueue = jest.fn();
  const id = t.addStreamingMessage("DAVAI", { content: "One." });
  const { rerender } = render(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("One.");
  t.appendToMessage(id, " Two.");
  rerender(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("Two.");
});

it("flushes the final remainder when the message finalizes (even without trailing punctuation)", () => {
  const t = ChatTranscriptModel.create({ messages: [] });
  const enqueue = jest.fn();
  const id = t.addStreamingMessage("DAVAI", { content: "All done" });
  const { rerender } = render(provider(t, enqueue));
  expect(enqueue).not.toHaveBeenCalled(); // no completed sentence yet
  t.finalizeStreamingMessage(id, "All done now");
  rerender(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("All done now");
});
