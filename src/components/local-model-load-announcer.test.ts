import { createLoadAnnouncer } from "./local-model-load-announcer";
import { DAVAI_SPEAKER } from "../constants";

// PR #114 review item 10: focused unit coverage for the load-announcement logic extracted out of
// App.tsx's own effect — exercises the exact milestone/first-progress/cache-load/per-model-reset
// behavior App.test.tsx already covers end-to-end, but without rendering the whole App component.
describe("createLoadAnnouncer (PR #114 review item 10)", () => {
  it("announces once immediately on the very first download-progress tick, before any 25% milestone", () => {
    const addMessage = jest.fn();
    const announce = createLoadAnnouncer(addMessage);
    announce({ status: "loading", progress: 0.01, text: "Fetching param cache[1/24]: 12MB fetched. 3% completed." });
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/Downloading the local model/),
      kind: "announcement",
    }));
  });

  it("announces only coarse 25% milestones, never per-tick, and a single distinct readiness message", () => {
    const addMessage = jest.fn();
    const announce = createLoadAnnouncer(addMessage);
    announce({ status: "loading", progress: 0.01, text: "Fetching param cache[1/24]: 3% completed." });
    announce({ status: "loading", progress: 0.1, text: "Fetching param cache[2/24]: 10% completed." });
    announce({ status: "loading", progress: 0.24, text: "Fetching param cache[5/24]: 24% completed." });
    expect(addMessage).toHaveBeenCalledTimes(1); // still just the first-progress announcement

    announce({ status: "loading", progress: 0.26, text: "Fetching param cache[6/24]: 26% completed." });
    announce({ status: "loading", progress: 0.3, text: "Fetching param cache[7/24]: 30% completed." });
    expect(addMessage).toHaveBeenCalledTimes(2);
    expect(addMessage).toHaveBeenLastCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/25% complete/),
    }));

    announce({ status: "loading", progress: 0.55, text: "Fetching param cache[13/24]: 55% completed." });
    expect(addMessage).toHaveBeenCalledTimes(3);
    expect(addMessage).toHaveBeenLastCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/50% complete/),
    }));

    announce({ status: "loading", progress: 0.8, text: "Fetching param cache[19/24]: 80% completed." });
    expect(addMessage).toHaveBeenCalledTimes(4);
    expect(addMessage).toHaveBeenLastCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/75% complete/),
    }));

    announce({ status: "loading", progress: 0.99, text: "Fetching param cache[24/24]: 99% completed." });
    expect(addMessage).toHaveBeenCalledTimes(4); // still within the last quartile — no new message

    announce({ status: "ready" });
    expect(addMessage).toHaveBeenCalledTimes(5);
    expect(addMessage).toHaveBeenLastCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/local model is ready/),
      kind: "announcement",
    }));
  });

  it("suppresses download/milestone announcements for a cache-read load (text lacks \"Fetching\"), " +
    "announcing only the final readiness message", () => {
    const addMessage = jest.fn();
    const announce = createLoadAnnouncer(addMessage);
    announce({ status: "loading", progress: 0.1, text: "Loading model from cache[3/24]" });
    announce({ status: "loading", progress: 0.5, text: "Loading model from cache[14/24]" });
    announce({ status: "loading", progress: 0.99, text: "Loading model from cache[24/24]" });
    expect(addMessage).not.toHaveBeenCalled();

    announce({ status: "ready" });
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/local model is ready/),
    }));
  });

  it("resets the milestone/first-progress tracking when the modelId changes mid-stream, so a " +
    "second model's load announces its own first-progress and 25% milestone again", () => {
    const addMessage = jest.fn();
    const announce = createLoadAnnouncer(addMessage);
    announce({ status: "loading", modelId: "model-A", progress: 0.02, text: "Fetching param cache[1/24]: 2% completed." });
    announce({ status: "loading", modelId: "model-A", progress: 0.8, text: "Fetching param cache[19/24]: 80% completed." });
    const beforeSwitch = addMessage.mock.calls.length;
    expect(beforeSwitch).toBeGreaterThan(0);

    announce({ status: "loading", modelId: "model-B", progress: 0.02, text: "Fetching param cache[1/40]: 2% completed." });
    expect(addMessage).toHaveBeenLastCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/Downloading the local model/),
    }));

    announce({ status: "loading", modelId: "model-B", progress: 0.3, text: "Fetching param cache[12/40]: 30% completed." });
    expect(addMessage).toHaveBeenLastCalledWith(DAVAI_SPEAKER, expect.objectContaining({
      content: expect.stringMatching(/25% complete/),
    }));
  });

  it("ignores a loading event with no numeric progress and any status other than loading/ready", () => {
    const addMessage = jest.fn();
    const announce = createLoadAnnouncer(addMessage);
    announce({ status: "loading" }); // no `progress` field at all
    announce({ status: "idle" });
    announce({ status: "error", error: "boom" });
    expect(addMessage).not.toHaveBeenCalled();
  });
});
