import "openai/shims/node";
import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { types } from "mobx-state-tree";

import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModelType } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { mockAppConfig } from "../test-utils/mock-app-config";
import { IRootStore } from "../models/root-store";
import { RootStoreProvider } from "../contexts/root-store-context";
import { GraphSonificationModelType } from "../models/graph-sonification-model";

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

const setEffortSpy = jest.fn();
const setLlmIdSpy = jest.fn();

// Mutable mock config so individual tests can vary the selected llmId/effort/llmList.
let mockConfig: any;

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => mockConfig),
    initialize: jest.fn(),
  }
}));

jest.mock("../contexts/app-config-context", () => ({
  useAppConfigContext: jest.fn(() => mockConfig),
}));

const renderDeveloperOptions = () => {
  const mockSonificationStore = {
  } as unknown as GraphSonificationModelType;

  const mockRootStore = {
    sonificationStore: mockSonificationStore,
  } as unknown as IRootStore;

  return render(
    <RootStoreProvider rootStore={mockRootStore}>
      <DeveloperOptionsComponent
        createToggleOption={() => <div />}
        assistantStore={mockAssistantStore}
        onInitializeAssistant={jest.fn()}
      />
    </RootStoreProvider>
  );
};

describe("test developer options component", () => {
  beforeEach(() => {
    setEffortSpy.mockClear();
    setLlmIdSpy.mockClear();
    mockConfig = {
      ...mockAppConfig,
      isDevMode: true,
      setEffort: setEffortSpy,
      setLlmId: setLlmIdSpy,
    };
  });

  it("renders a developer options component with mock assistant checkbox and thread buttons", async () => {
    renderDeveloperOptions();

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

  it("reflects the selected model in the LLM dropdown (option value matches canonical llmId)", () => {
    // The canonical llmId carries only { id, provider }; llmList entries also carry
    // effortLevels/defaultEffort, so option values must be serialized down to { id, provider }
    // or the select would match no option and fall back to the first (Mock).
    mockConfig.llmId = JSON.stringify({ id: "gemini-2.0-flash", provider: "Google" });

    renderDeveloperOptions();

    expect(screen.getByTestId("llm-select")).toHaveValue('{"id":"gemini-2.0-flash","provider":"Google"}');
  });

  it("renders the effort options for the selected model", () => {
    mockConfig.llmId = JSON.stringify(
      { id: "gemini-2.0-flash", provider: "Google", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" }
    );
    mockConfig.effort = "medium";

    renderDeveloperOptions();

    const select = screen.getByTestId("effort-select");
    expect(select).toBeEnabled();
    const opts = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(opts).toEqual(["low", "medium", "high"]);
  });

  it("disables the effort menu for a no-effort model", () => {
    mockConfig.llmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI", effortLevels: [] });
    mockConfig.effort = "";

    renderDeveloperOptions();

    const select = screen.getByTestId("effort-select");
    expect(select).toBeDisabled();
    expect(within(select).queryAllByRole("option").length).toBe(0);
  });

  it("calls setEffort when a level is chosen", () => {
    mockConfig.llmId = JSON.stringify(
      { id: "gemini-2.0-flash", provider: "Google", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" }
    );
    mockConfig.effort = "medium";

    renderDeveloperOptions();

    const select = screen.getByTestId("effort-select");
    fireEvent.change(select, { target: { value: "low" } });
    expect(setEffortSpy).toHaveBeenCalledWith("low");
  });

  it("resets effort to the new model's default when the model changes", () => {
    mockConfig.llmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI", effortLevels: [] });
    mockConfig.effort = "";

    renderDeveloperOptions();

    const llmSelect = screen.getByTestId("llm-select");
    // The dropdown emits the canonical { id, provider } value (see the LLM select).
    const newLlmId = JSON.stringify({ id: "gemini-2.0-flash", provider: "Google" });
    fireEvent.change(llmSelect, { target: { value: newLlmId } });

    expect(setLlmIdSpy).toHaveBeenCalledWith(newLlmId);
    expect(setEffortSpy).toHaveBeenCalledWith("medium");
  });

  it("resets effort to empty string when switching to a no-effort model", () => {
    mockConfig.llmId = JSON.stringify(
      { id: "gemini-2.0-flash", provider: "Google", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" }
    );
    mockConfig.effort = "medium";

    renderDeveloperOptions();

    const llmSelect = screen.getByTestId("llm-select");
    const newLlmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" });
    fireEvent.change(llmSelect, { target: { value: newLlmId } });

    expect(setLlmIdSpy).toHaveBeenCalledWith(newLlmId);
    expect(setEffortSpy).toHaveBeenCalledWith("");
  });
});
