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

jest.mock("../contexts/root-store-context", () => ({
  useRootStore: jest.fn(() => ({
    assistantStore: {
      initializeAssistant: jest.fn(),
      transcriptStore: {
        messages: [],
        addMessage: jest.fn(),
      }
    },
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

describe("test load app", () => {
  beforeEach(() => {
    setupMockSpeechSynthesis();
  });

  afterEach(() => {
    cleanupMockSpeechSynthesis();
  });

  it("renders without crashing", () => {
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
    expect(screen.getByText("DAVAI")).toBeDefined();
    expect(screen.getByTestId("chat-transcript")).toBeDefined();
    expect(screen.getByTestId("chat-input")).toBeDefined();
  });
});
