import "openai/shims/node";
import React from "react";
import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { mockAppConfig } from "../test-utils/mock-app-config";
import { MockAppConfigProvider } from "../test-utils/app-config-provider";
import { ShortcutsServiceProvider } from "../contexts/shortcuts-service-context";
import { AriaLiveProvider } from "../contexts/aria-live-context";
import { SpeechServiceProvider } from "../contexts/speech-service-context";
import { mockTransportManager } from "../test-utils/mock-transport-manager";
import { setupMockSpeechSynthesis, cleanupMockSpeechSynthesis } from "../test-utils/mock-speech-synthesis";

// Mutable so individual tests can vary the busy/streaming state the App reads.
const mockAssistantStore: any = {
  initializeAssistant: jest.fn(),
  updateDataContexts: jest.fn(),
  updateGraphs: jest.fn(),
  handleCancel: jest.fn(),
  handleMessageSubmit: jest.fn(),
  setStreamEnabled: jest.fn(),
  transcriptStore: { messages: [], addMessage: jest.fn() },
  threadId: "thread-1",
  showLoadingIndicator: false,
  isLoadingResponse: false,
  isResponding: false,
};

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
  beforeEach(() => {
    setupMockSpeechSynthesis();
    mockAssistantStore.threadId = "thread-1";
    mockAssistantStore.showLoadingIndicator = false;
    mockAssistantStore.isLoadingResponse = false;
    mockAssistantStore.isResponding = false;
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
});
