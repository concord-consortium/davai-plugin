import "openai/shims/node";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { types } from "mobx-state-tree";

import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModelType } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { mockAppConfig } from "../test-utils/mock-app-config";

const MockAssistantModel = types
  .model("MockAssistantModel", {
    llmId: types.string,
    llmList: types.optional(types.map(types.string), {}),
    thread: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel
  })
  .actions((self) => ({
    createThread: jest.fn(),
    deleteThread: jest.fn()
  }));

const mockTranscriptStore = ChatTranscriptModel.create({
  messages: [
    {
      speaker: "DAVAI",
      messageContent: { content: "Hello. How can I help you today?" },
      timestamp: "2021-07-01T12:00:00Z",
      id: "msg_1",
    },
  ],
});

const mockAssistantStore = MockAssistantModel.create({
  llmId: "{\"id\":\"gpt-4o-mini\",\"provider\":\"OpenAI\"}",
  thread: {},
  transcriptStore: mockTranscriptStore,
}) as unknown as AssistantModelType;

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => ({...mockAppConfig, isDevMode: true})),
    initialize: jest.fn(),
  }
}));

jest.mock("../contexts/app-config-context", () => ({
  useAppConfigContext: jest.fn(() => ({...mockAppConfig, isDevMode: true})),
}));

describe("test developer options component", () => {

  it("renders a developer options component with mock assistant checkbox and thread buttons", async () => {
    render(<DeveloperOptionsComponent
      createToggleOption={() => <div />}
      assistantStore={mockAssistantStore}
      onInitializeAssistant={jest.fn()}
    />);

    const developerOptions = screen.getByTestId("developer-options");
    expect(developerOptions).toBeInTheDocument();

    const selectLlmOptionLabel = screen.getByTestId("llm-select-label");
    expect(selectLlmOptionLabel).toHaveTextContent("Select an LLM");
    const selectLlmOption = screen.getByTestId("llm-select");
    expect(selectLlmOption).toBeInTheDocument();
    await waitFor(() => {
      expect(selectLlmOption).toHaveValue('{"id":"mock","provider":"Mock"}');
    });
    await waitFor(() => {
      expect(selectLlmOption).toHaveTextContent("Mock LLM");
    });

    // TODO: Reinstate these test once thread management is fully implemented.
    // const deleteThreadButton = screen.getByTestId("delete-thread-button");
    // expect(deleteThreadButton).toBeInTheDocument();
    // expect(deleteThreadButton).toBeEnabled();
    // expect(deleteThreadButton).toHaveTextContent("Delete Thread");

    // const newThreadButton = screen.getByTestId("new-thread-button");
    // expect(newThreadButton).toBeInTheDocument();
    // expect(newThreadButton).toHaveAttribute("aria-disabled", "true");
    // expect(newThreadButton).toHaveTextContent("New Thread");
  });
});
