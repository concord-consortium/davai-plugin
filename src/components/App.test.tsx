import "openai/shims/node";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { App } from "./App";
import { mockAppConfig } from "../test-utils/mock-app-config";
import { MockAppConfigProvider } from "../test-utils/app-config-provider";
import { ShortcutsServiceProvider } from "../contexts/shortcuts-service-context";
import { AriaLiveProvider } from "../contexts/aria-live-context";
import { SpeechServiceProvider, SpeechServiceContext } from "../contexts/speech-service-context";
import { ISpeechService } from "../services/speech-service";
import { mockTransportManager } from "../test-utils/mock-transport-manager";
import { setupMockSpeechSynthesis, cleanupMockSpeechSynthesis } from "../test-utils/mock-speech-synthesis";
import { DAVAI_SPEAKER } from "../constants";
import { localLlmService, ILocalLlmLoadState } from "../utils/local-llm/local-llm-service";

// Captures the callback the App component registers via onLoadStateChange, so tests can
// drive load-progress/ready notifications directly, plus a dedicated unsubscribe jest.fn()
// (rather than an inline () => undefined) so unmount cleanup can be asserted on.
let loadStateChangeCallback: ((s: ILocalLlmLoadState) => void) | undefined;
const mockUnsubscribeLoadStateChange = jest.fn();

jest.mock("../utils/local-llm/local-llm-service", () => ({
  localLlmService: {
    isWebGPUAvailable: jest.fn(() => true),
    loadEngine: jest.fn().mockResolvedValue(undefined),
    generate: jest.fn(),
    interrupt: jest.fn(),
    unload: jest.fn().mockResolvedValue(undefined),
    getLoadState: jest.fn(() => ({ status: "ready" })),
    onLoadStateChange: jest.fn(),
  },
}));

const createMockSpeechService = (): ISpeechService => ({
  speak: jest.fn(),
  stopSpeech: jest.fn(),
  stopAndSuppress: jest.fn(),
  enqueue: jest.fn(),
  speakIfIdle: jest.fn(),
  resumeSpeech: jest.fn(),
  isSpeaking: jest.fn(() => false),
  dispose: jest.fn(),
  onSpeakingChange: jest.fn(() => jest.fn()),
});

// Mutable so individual tests can vary the busy/streaming state the App reads.
const mockAssistantStore: any = {
  initializeAssistant: jest.fn(),
  updateDataContexts: jest.fn(),
  updateGraphs: jest.fn(),
  handleCancel: jest.fn(),
  handleMessageSubmit: jest.fn(),
  handleMessageSubmitLocalLlm: jest.fn(),
  setStreamEnabled: jest.fn(),
  setEffort: jest.fn(),
  transcriptStore: { messages: [], addMessage: jest.fn() },
  threadId: "thread-1",
  showLoadingIndicator: false,
  isLoadingResponse: false,
  isResponding: false,
};

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  ...jest.requireActual("@concord-consortium/codap-plugin-api"),
  initializePlugin: jest.fn(),
  selectSelf: jest.fn(),
}));

jest.mock("../contexts/root-store-context", () => ({
  useRootStore: jest.fn(() => ({
    assistantStore: mockAssistantStore,
    sonificationStore: {
      selectedGraph: { id: "graph1", name: "Graph 1" },
      setGraphs: jest.fn(),
    },
    transportManager: mockTransportManager
  }))
}));

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => (mockAppConfig)),
    initialize: jest.fn(),
  },
  DotPlotMode: {
    CONTINUAL: "continual",
    EACH_DOT: "each-dot"
  },
  ScatterPlotContinuousType: {
    LSRL: "lsrl",
    LOESS: "loess"
  }
}));

const renderApp = () =>
  render(
    <MockAppConfigProvider>
      <ShortcutsServiceProvider>
        <AriaLiveProvider>
          <SpeechServiceProvider>
            <App />
          </SpeechServiceProvider>
        </AriaLiveProvider>
      </ShortcutsServiceProvider>
    </MockAppConfigProvider>
  );

describe("test load app", () => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();

  beforeEach(() => {
    setupMockSpeechSynthesis();
    mockAssistantStore.threadId = "thread-1";
    mockAssistantStore.showLoadingIndicator = false;
    mockAssistantStore.isLoadingResponse = false;
    mockAssistantStore.isResponding = false;
    mockAssistantStore.transcriptStore = { messages: [], addMessage: jest.fn() };
    (mockAppConfig as any).isLocalLlm = false;
    // mockAppConfig is a shared module-level object (see the app-config-model mock above,
    // which hands it back as-is rather than constructing a real MST instance) — reset the
    // llmId/llmList fields the DAVAI-126 engine-lifecycle effect reads so a Local override
    // in one test can't leak into another.
    mockAppConfig.llmId = "{\"id\":\"mock\",\"provider\":\"Mock\"}";
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "gemini-2.0-flash", provider: "Google", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" },
      { id: "gpt-4o-mini", provider: "OpenAI", effortLevels: [] }
    ];
    // Reset the WebGPU-availability default (a test can override it to false) and capture
    // the milestone-effect's callback whenever the App (re-)registers via onLoadStateChange.
    (localLlmService.isWebGPUAvailable as jest.Mock).mockReturnValue(true);
    loadStateChangeCallback = undefined;
    (localLlmService.onLoadStateChange as jest.Mock).mockImplementation((cb: (s: ILocalLlmLoadState) => void) => {
      loadStateChangeCallback = cb;
      return mockUnsubscribeLoadStateChange;
    });
  });

  afterEach(() => {
    cleanupMockSpeechSynthesis();
    // Several assistantStore/CODAP mocks are shared module-level jest.fn()s; clear their
    // call history between tests so a submit assertion here can't see a call left over
    // from an earlier test in this file (e.g. handleMessageSubmit from a prior submit).
    jest.clearAllMocks();
  });

  it("renders without crashing", () => {
    renderApp();
    expect(screen.getByText("DAVAI")).toBeDefined();
    expect(screen.getByTestId("chat-transcript")).toBeDefined();
    expect(screen.getByTestId("chat-input")).toBeDefined();
  });

  it("skips CODAP wiring when running outside CODAP (standalone window)", () => {
    // jsdom is a top-level window (window.parent === window), i.e. the standalone case:
    // no CODAP requests may be made on mount — with no parent frame to answer them they
    // would surface as timeouts and uncaught errors in the dev overlay.
    renderApp();

    expect(initializePlugin).not.toHaveBeenCalled();
    expect(selectSelf).not.toHaveBeenCalled();
  });

  it("shows the Cancel button (not Send) while a response is streaming", () => {
    // Mirrors streaming after the first chunk: the "Processing" indicator is cleared
    // (showLoadingIndicator false) but a response is still in flight, so the chat input
    // must stay busy with a Cancel button rather than re-enabling Send.
    mockAssistantStore.isLoadingResponse = true;
    mockAssistantStore.showLoadingIndicator = false;
    mockAssistantStore.isResponding = true;

    renderApp();

    expect(screen.getByTestId("chat-input-cancel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-input-send")).not.toBeInTheDocument();
  });

  it("announces a finalized DAVAI response, voicing bullets as 'bullet'", async () => {
    // A non-streamed DAVAI response that is the last transcript row should be announced
    // via the assertive aria-live region, with the bullet marker voiced as the word.
    mockAssistantStore.transcriptStore = {
      messages: [
        {
          speaker: DAVAI_SPEAKER, isStreaming: false, id: "1", timestamp: "t",
          messageContent: { content: "- Apple" }, plainTextContent: "- Apple"
        }
      ],
      addMessage: jest.fn(),
    };

    renderApp();

    expect(await screen.findByText("bullet Apple")).toBeInTheDocument();
  });

  it("stops any in-progress speech when a new message is submitted", () => {
    renderApp();

    fireEvent.change(screen.getByTestId("chat-input-textarea"), { target: { value: "Another question" } });
    fireEvent.click(screen.getByTestId("chat-input-send"));

    // stopSpeech() cancels the browser speech synthesis, so a fresh question interrupts
    // the previous answer's still-playing audio.
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it("routes chat submission to the local LLM handler when isLocalLlm is true (DAVAI-126)", () => {
    (mockAppConfig as any).isLocalLlm = true;

    renderApp();

    fireEvent.change(screen.getByTestId("chat-input-textarea"), { target: { value: "describe the graph" } });
    fireEvent.click(screen.getByTestId("chat-input-send"));

    expect(mockAssistantStore.handleMessageSubmitLocalLlm).toHaveBeenCalledWith("describe the graph");
    expect(mockAssistantStore.handleMessageSubmit).not.toHaveBeenCalled();
  });

  it("clears Escape/Stop suppression on submit so the next Processing message is read", () => {
    const mockService = createMockSpeechService();
    render(
      <MockAppConfigProvider>
        <ShortcutsServiceProvider>
          <AriaLiveProvider>
            <SpeechServiceContext.Provider value={{ speechService: mockService, isSpeaking: false, currentSpeechText: null }}>
              <App />
            </SpeechServiceContext.Provider>
          </AriaLiveProvider>
        </ShortcutsServiceProvider>
      </MockAppConfigProvider>
    );

    fireEvent.change(screen.getByTestId("chat-input-textarea"), { target: { value: "Question" } });
    fireEvent.click(screen.getByTestId("chat-input-send"));

    expect(mockService.stopSpeech).toHaveBeenCalled();
    expect(mockService.resumeSpeech).toHaveBeenCalled(); // lifts a prior Escape/Stop suppression
  });

  it("starts loading the local engine when a Local model is selected (DAVAI-126)", () => {
    mockAppConfig.llmId = JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" });
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];

    renderApp();

    expect(localLlmService.loadEngine).toHaveBeenCalledWith("Qwen3-1.7B-q4f16_1-MLC");
  });

  it("unloads the local engine when a server model is selected (DAVAI-126)", () => {
    renderApp(); // default (non-Local) config

    expect(localLlmService.unload).toHaveBeenCalled();
  });

  it("announces only coarse 25% milestones and a single readiness message, never per-percent (DAVAI-126)", () => {
    mockAppConfig.llmId = JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" });
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];

    renderApp();

    // The App registers its milestone-subscription callback on mount; capture it via the
    // mocked onLoadStateChange so this test can drive load-progress notifications directly.
    expect(loadStateChangeCallback).toBeDefined();
    const addMessage = mockAssistantStore.transcriptStore.addMessage as jest.Mock;
    // The "loading" start message (and possibly a WebGPU/failure message) from the llmId
    // effect fires before any progress events; only milestone-effect calls matter below.
    const callsBeforeProgress = addMessage.mock.calls.length;

    const drive = (state: Parameters<NonNullable<typeof loadStateChangeCallback>>[0]) =>
      act(() => loadStateChangeCallback!(state));

    // Fine-grained progress within the first quartile: no milestone message yet.
    drive({ status: "loading", progress: 0.01 });
    drive({ status: "loading", progress: 0.10 });
    drive({ status: "loading", progress: 0.24 });
    expect(addMessage.mock.calls.length).toBe(callsBeforeProgress);

    // Crossing 25%: exactly one "25% complete" message, even though two ticks land in
    // the same quartile (0.26 then 0.30) — proving 25%-step coarseness, not per-tick spam.
    drive({ status: "loading", progress: 0.26 });
    drive({ status: "loading", progress: 0.30 });
    expect(addMessage).toHaveBeenCalledTimes(callsBeforeProgress + 1);
    expect(addMessage).toHaveBeenNthCalledWith(callsBeforeProgress + 1, DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/25% complete/) }));

    // Crossing 50%: exactly one more message.
    drive({ status: "loading", progress: 0.55 });
    expect(addMessage).toHaveBeenCalledTimes(callsBeforeProgress + 2);
    expect(addMessage).toHaveBeenNthCalledWith(callsBeforeProgress + 2, DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/50% complete/) }));

    // Crossing 75%: exactly one more message.
    drive({ status: "loading", progress: 0.80 });
    expect(addMessage).toHaveBeenCalledTimes(callsBeforeProgress + 3);
    expect(addMessage).toHaveBeenNthCalledWith(callsBeforeProgress + 3, DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/75% complete/) }));

    // Still within the same (last) quartile: no new message.
    drive({ status: "loading", progress: 0.99 });
    expect(addMessage).toHaveBeenCalledTimes(callsBeforeProgress + 3);

    // Readiness: exactly one "ready" message, distinct from a 100% progress announcement.
    drive({ status: "ready" });
    expect(addMessage).toHaveBeenCalledTimes(callsBeforeProgress + 4);
    expect(addMessage).toHaveBeenNthCalledWith(callsBeforeProgress + 4, DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/local model is ready/) }));
  });

  it("unsubscribes from load-state changes on unmount (DAVAI-126)", () => {
    const { unmount } = renderApp();

    expect(loadStateChangeCallback).toBeDefined();
    // Establish a clean baseline rather than asserting zero calls: RTL's own auto-cleanup
    // afterEach (registered at import time, outside this file's describe block) runs after
    // this describe's afterEach in Jest's hook order, so a previous test's renderApp() can
    // still be unmounted — and its real unsubscribe invoked — after jest.clearAllMocks().
    mockUnsubscribeLoadStateChange.mockClear();

    unmount();

    expect(mockUnsubscribeLoadStateChange).toHaveBeenCalledTimes(1);
  });

  it("announces the expected download size for the 1.7B local model (DAVAI-126)", () => {
    mockAppConfig.llmId = JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" });
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];

    renderApp();

    expect(mockAssistantStore.transcriptStore.addMessage).toHaveBeenCalledWith(DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/about 1\.1 GB/) }));
  });

  it("announces the expected download size for the 4B local model (DAVAI-126)", () => {
    mockAppConfig.llmId = JSON.stringify({ id: "Qwen3-4B-q4f16_1-MLC", provider: "Local" });
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-4B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];

    renderApp();

    expect(mockAssistantStore.transcriptStore.addMessage).toHaveBeenCalledWith(DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/about 2\.3 GB/) }));
  });

  it("explains the WebGPU requirement and skips loadEngine when WebGPU is unavailable (DAVAI-126)", () => {
    (localLlmService.isWebGPUAvailable as jest.Mock).mockReturnValue(false);
    mockAppConfig.llmId = JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" });
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];

    renderApp();

    expect(mockAssistantStore.transcriptStore.addMessage).toHaveBeenCalledWith(DAVAI_SPEAKER,
      expect.objectContaining({ content: expect.stringMatching(/WebGPU/) }));
    expect(localLlmService.loadEngine).not.toHaveBeenCalled();
  });

  it("announces a failure message when the local engine fails to load (DAVAI-126)", async () => {
    (localLlmService.loadEngine as jest.Mock).mockRejectedValueOnce(new Error("download failed"));
    mockAppConfig.llmId = JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" });
    mockAppConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];

    renderApp();

    await waitFor(() => {
      expect(mockAssistantStore.transcriptStore.addMessage).toHaveBeenCalledWith(DAVAI_SPEAKER,
        expect.objectContaining({ content: expect.stringMatching(/failed to load.*download failed/) }));
    });
  });
});
