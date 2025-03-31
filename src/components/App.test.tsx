import "openai/shims/node";
import React from "react";
import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { mockAppConfig } from "../test-utils/mock-app-config";
import { MockAppConfigProvider } from "../test-utils/app-config-provider";

jest.mock("../hooks/use-assistant-store", () => ({
  useAssistantStore: jest.fn(() => ({
    initializeAssistant: jest.fn(),
    fetchAssistantsList: jest.fn(),
    transcriptStore: {
      messages: [],
      addMessage: jest.fn(),
    },
  })),
}));

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => (mockAppConfig)),
    initialize: jest.fn(),
  }
}));


describe("test load app", () => {
  it("renders without crashing", () => {
    render(
      <MockAppConfigProvider>
        <App />
      </MockAppConfigProvider>
    );
    expect(screen.getByText("DAVAI")).toBeDefined();
    expect(screen.getByTestId("chat-transcript")).toBeDefined();
    expect(screen.getByTestId("chat-input")).toBeDefined();
  });
});
