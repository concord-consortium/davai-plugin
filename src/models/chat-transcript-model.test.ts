import { ChatTranscriptModel } from "./chat-transcript-model";

const make = () => ChatTranscriptModel.create({ messages: [] });

describe("streaming messages", () => {
  it("addStreamingMessage returns an id and marks the message streaming", () => {
    const t = make();
    const id = t.addStreamingMessage("DAVAI", { content: "Hello" });
    const msg = t.messages.find((m) => m.id === id)!;
    expect(msg.isStreaming).toBe(true);
    expect(msg.messageContent.content).toBe("Hello");
  });
  it("appendToMessage grows the content", () => {
    const t = make();
    const id = t.addStreamingMessage("DAVAI", { content: "Hello" });
    t.appendToMessage(id, " world");
    expect(t.messages.find((m) => m.id === id)!.messageContent.content).toBe("Hello world");
  });
  it("finalizeStreamingMessage sets content wholesale and clears the flag", () => {
    const t = make();
    const id = t.addStreamingMessage("DAVAI", { content: "Hel" });
    t.finalizeStreamingMessage(id, "Hello world.");
    const msg = t.messages.find((m) => m.id === id)!;
    expect(msg.messageContent.content).toBe("Hello world.");
    expect(msg.isStreaming).toBe(false);
  });
  it("removeMessage deletes the message", () => {
    const t = make();
    const id = t.addStreamingMessage("DAVAI", { content: "x" });
    t.removeMessage(id);
    expect(t.messages.find((m) => m.id === id)).toBeUndefined();
  });
});
