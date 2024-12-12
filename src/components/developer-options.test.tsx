import "openai/shims/node";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModel } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { MockAppConfigProvider } from "../test-utils/app-config-provider";
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
  assistant: {},
  assistantId: "asst_abc123",
  instructions: "This is just a test",
  modelName: "test-model",
  thread: {},
  transcriptStore: mockTranscriptStore,
  useExistingAssistant: true,
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
  const onMockAssistant = jest.fn();

  const WrapperComponent = () => {
    return (
      <MockAppConfigProvider>
        <DeveloperOptionsComponent
          assistantStore={mockAssistantStore}
          onCreateThread={onCreateThread}
          onDeleteThread={onDeleteThread}
          onMockAssistant={onMockAssistant}
        />
      </MockAppConfigProvider>
    );
  };

  it("renders a developer options component with mock assistant checkbox and thread buttons", () => {
    render(<WrapperComponent />);

    const developerOptions = screen.getByTestId("developer-options");
    expect(developerOptions).toBeInTheDocument();

    const mockAssistantCheckbox = screen.getByTestId("mock-assistant-checkbox");
    expect(mockAssistantCheckbox).toBeInTheDocument();
    expect(mockAssistantCheckbox).toHaveAttribute("type", "checkbox");
    expect(mockAssistantCheckbox).toHaveProperty("checked", false);
    const mockAssistantCheckboxLabel = screen.getByTestId("mock-assistant-checkbox-label");
    expect(mockAssistantCheckboxLabel).toHaveTextContent("Use Mock Assistant");
    fireEvent.click(mockAssistantCheckbox);
    expect(onMockAssistant).toHaveBeenCalledTimes(1);

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
