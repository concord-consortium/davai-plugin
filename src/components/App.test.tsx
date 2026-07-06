import "openai/shims/node";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
  });

  afterEach(() => {
    cleanupMockSpeechSynthesis();
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
});
