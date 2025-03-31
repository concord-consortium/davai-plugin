import "openai/shims/node";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModel } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { mockAppConfig } from "../test-utils/mock-app-config";

const mockTranscriptStore = ChatTranscriptModel.create({
  messages: [
    {
      speaker: "DAVAI",
      content: "Hello. How can I help you today?",
      timestamp: "2021-07-01T12:00:00Z",
      id: "msg_1",
    },
  ],
});

const mockAssistantStore = AssistantModel.create({
  apiConnection: {
    apiKey: "abc123",
    dangerouslyAllowBrowser: true
  },
  assistant: {},
  assistantId: "asst_abc123",
  assistantList: {
    asst_abc123: "Jest Mock Assistant",
  },
  thread: {},
  transcriptStore: mockTranscriptStore,
});

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => ({...mockAppConfig, mode: "development"})),
    initialize: jest.fn(),
  }
}));

jest.mock("../hooks/use-app-config-context", () => ({
  useAppConfigContext: jest.fn(() => ({...mockAppConfig, mode: "development"})),
}));

describe("test developer options component", () => {

  it("renders a developer options component with mock assistant checkbox and thread buttons", async () => {
    render(<DeveloperOptionsComponent
      createToggleOption={() => <div />}
      assistantStore={mockAssistantStore}
    />);

    const developerOptions = screen.getByTestId("developer-options");
    expect(developerOptions).toBeInTheDocument();

    const selectAssistantOptionLabel = screen.getByTestId("assistant-select-label");
    expect(selectAssistantOptionLabel).toHaveTextContent("Select an Assistant");
    const selectAssistantOption = screen.getByTestId("assistant-select");
    expect(selectAssistantOption).toBeInTheDocument();
    await waitFor(() => {
      expect(selectAssistantOption).toHaveValue("asst_abc123");
    });
    await waitFor(() => {
      expect(selectAssistantOption).toHaveTextContent("Jest Mock Assistant");
    });

    const deleteThreadButton = screen.getByTestId("delete-thread-button");
    expect(deleteThreadButton).toBeInTheDocument();
    expect(deleteThreadButton).toBeEnabled();
    expect(deleteThreadButton).toHaveTextContent("Delete Thread");

    const newThreadButton = screen.getByTestId("new-thread-button");
    expect(newThreadButton).toBeInTheDocument();
    expect(newThreadButton).toHaveAttribute("aria-disabled", "true");
    expect(newThreadButton).toHaveTextContent("New Thread");
  });
});
