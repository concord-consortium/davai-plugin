import "openai/shims/node";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModel } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { MockAppConfigProvider } from "../test-utils/app-config-provider";
import { mockAppConfig } from "../test-utils/mock-app-config";
import { MockOpenAiConnectionProvider } from "../test-utils/openai-connection-provider";

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
  thread: {},
  transcriptStore: mockTranscriptStore,
});

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => (mockAppConfig)),
    initialize: jest.fn(),
  }
}));

describe("test developer options component", () => {
  const onCreateThread = jest.fn();
  const onDeleteThread = jest.fn();
  const onSelectAssistant = jest.fn();

  const WrapperComponent = () => {
    return (
      <MockAppConfigProvider>
        <MockOpenAiConnectionProvider>
          <DeveloperOptionsComponent
            assistantStore={mockAssistantStore}
            onCreateThread={onCreateThread}
            onDeleteThread={onDeleteThread}
            onSelectAssistant={onSelectAssistant}
          />
        </MockOpenAiConnectionProvider>
      </MockAppConfigProvider>
    );
  };

  it("renders a developer options component with mock assistant checkbox and thread buttons", async () => {
    render(<WrapperComponent />);

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
    fireEvent.change(selectAssistantOption, { target: { value: "mock" } });
    expect(onSelectAssistant).toHaveBeenCalledTimes(1);

    const deleteThreadButton = screen.getByTestId("delete-thread-button");
    expect(deleteThreadButton).toBeInTheDocument();
    expect(deleteThreadButton).toBeEnabled();
    expect(deleteThreadButton).toHaveTextContent("Delete Thread");
    fireEvent.click(deleteThreadButton);
    expect(onDeleteThread).toHaveBeenCalledTimes(1);

    const newThreadButton = screen.getByTestId("new-thread-button");
    expect(newThreadButton).toBeInTheDocument();
    expect(newThreadButton).toBeDisabled();
    expect(newThreadButton).toHaveTextContent("New Thread");
  });
});
