import { DAVAI_SPEAKER } from "../constants";
import { MessageContent } from "../types";
import { ILocalLlmLoadState } from "../utils/local-llm/local-llm-service";

export type AddTranscriptMessage = (speaker: string, messageContent: MessageContent) => void;

// Announces coarse local-model load milestones (25% steps) and readiness through the transcript,
// so the aria-live path reads them — per-percent updates would spam the screen reader. Extracted
// from App.tsx's own onLoadStateChange effect (PR #114 review item 10, reviewer's optional
// suggestion) into a plain, stateful factory so this logic is unit-testable without rendering the
// whole App component; App.tsx's effect just calls `localLlmService.onLoadStateChange(
// createLoadAnnouncer(transcriptStore.addMessage))`. Behavior is unchanged from the inline version.
export const createLoadAnnouncer = (addMessage: AddTranscriptMessage): ((s: ILocalLlmLoadState) => void) => {
  let lastMilestone = 0;
  // Track which model the milestone counter belongs to. Switching models restarts progress at 0
  // for the new model, but a stale lastMilestone (e.g. 75 from the previous model) would
  // otherwise suppress the new model's 25/50/75 announcements. Reset when the model changes.
  let milestoneModelId: string | undefined;
  // Whether the one-time "download started" progress announcement has fired for the current
  // model's load. The first 25% milestone can take minutes on a slow connection, so this gives
  // feedback within seconds of the very first progress tick instead. Reset alongside the
  // milestone tracker (same per-modelId reset above) so a second load announces again.
  let announcedFirstProgress = false;

  return (s: ILocalLlmLoadState) => {
    if (s.status === "loading" && typeof s.progress === "number") {
      if (s.modelId !== milestoneModelId) {
        milestoneModelId = s.modelId;
        lastMilestone = 0;
        announcedFirstProgress = false;
      }
      // WebLLM's initProgressCallback fires for cache reads (an already-downloaded model) too,
      // with progress climbing 0 -> 1 in seconds. Its `text` distinguishes the phases: network
      // downloads say "Fetching param cache[...]"; cache reads say "Loading model from
      // cache[...]". Gate both the first-progress feedback and the 25/50/75% milestones on the
      // CURRENT event's text containing "Fetching" so a cache load — the common case once a
      // model is already downloaded — announces nothing but the final "ready" message.
      const isDownloadProgress = typeof s.text === "string" && s.text.includes("Fetching");
      if (isDownloadProgress) {
        if (!announcedFirstProgress && s.progress > 0) {
          announcedFirstProgress = true;
          addMessage(DAVAI_SPEAKER, {
            content: "Downloading the local model — progress will be announced at 25% steps.",
            kind: "announcement",
          });
        }
        const milestone = Math.floor(s.progress * 4) * 25;
        if (milestone > lastMilestone && milestone < 100) {
          lastMilestone = milestone;
          addMessage(DAVAI_SPEAKER, { content: `Model download: ${milestone}% complete.`, kind: "announcement" });
        }
      }
    } else if (s.status === "ready") {
      lastMilestone = 0;
      milestoneModelId = undefined;
      announcedFirstProgress = false;
      addMessage(DAVAI_SPEAKER, { content: "The local model is ready.", kind: "announcement" });
    }
  };
};
