import React from "react";
import { act, render } from "@testing-library/react";
import { StreamingAnnouncer } from "./streaming-announcer";
import { SpeechServiceContext } from "../contexts/speech-service-context";
import { ChatTranscriptModel } from "../models/chat-transcript-model";

const provider = (t: any, enqueue: jest.Mock, stopSpeech?: jest.Mock) => (
  <SpeechServiceContext.Provider value={{ speechService: { enqueue, stopSpeech: stopSpeech ?? jest.fn() } as any, isSpeaking: false, currentSpeechText: null }}>
    <StreamingAnnouncer transcript={t} />
  </SpeechServiceContext.Provider>
);

it("enqueues each completed sentence as the streaming message grows", () => {
  const t = ChatTranscriptModel.create({ messages: [] });
  const enqueue = jest.fn();
  const id = t.addStreamingMessage("DAVAI", { content: "One." });
  const { rerender } = render(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("One.");
  act(() => {
    t.appendToMessage(id, " Two.");
  });
  rerender(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("Two.");
});

it("flushes the final remainder when the message finalizes (even without trailing punctuation)", () => {
  const t = ChatTranscriptModel.create({ messages: [] });
  const enqueue = jest.fn();
  const id = t.addStreamingMessage("DAVAI", { content: "All done" });
  const { rerender } = render(provider(t, enqueue));
  expect(enqueue).not.toHaveBeenCalled(); // no completed sentence yet
  act(() => {
    t.finalizeStreamingMessage(id, "All done now");
  });
  rerender(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("All done now");
});

it("after a finished stream, a new streamed turn is still announced", () => {
  const t = ChatTranscriptModel.create({ messages: [] });
  const enqueue = jest.fn();

  // Turn A
  const idA = t.addStreamingMessage("DAVAI", { content: "One." });
  const { rerender } = render(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("One.");

  // Simulate finishStream: finalizeStreamingMessage keeps content, clears isStreaming
  act(() => { t.finalizeStreamingMessage(idA, "One."); });
  rerender(provider(t, enqueue));

  // Turn B — should still be announced
  let idB!: string;
  act(() => { idB = t.addStreamingMessage("DAVAI", { content: "Two." }); });
  rerender(provider(t, enqueue));
  expect(enqueue).toHaveBeenCalledWith("Two.");
  // Silence TS unused-variable warning
  void idB;
});

it("removing the tracked message stops queued speech", () => {
  const t = ChatTranscriptModel.create({ messages: [] });
  const enqueue = jest.fn();
  const stopSpeech = jest.fn();

  const idA = t.addStreamingMessage("DAVAI", { content: "Hello." });
  const { rerender } = render(provider(t, enqueue, stopSpeech));
  expect(enqueue).toHaveBeenCalledWith("Hello.");

  act(() => { t.removeMessage(idA); });
  rerender(provider(t, enqueue, stopSpeech));
  expect(stopSpeech).toHaveBeenCalled();
});
