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

// assistant-model.ts (imported above for its type, and transitively via root-store through
// RootStoreProvider) statically imports local-llm-service.ts, which imports this factory.
// It uses import.meta.url, which ts-jest's CJS transform cannot parse — mock it out the same
// way local-llm-service.test.ts does (this file never exercises local-LLM behavior).
jest.mock("../utils/local-llm/local-llm-worker-factory", () => ({
  createLocalLlmWorker: jest.fn(() => ({} as Worker)),
}));

const mockIsWebGPUAvailable = jest.fn(() => false);
jest.mock("../utils/local-llm/local-llm-service", () => ({
  localLlmService: { isWebGPUAvailable: () => mockIsWebGPUAvailable() },
}));

// Declared separately (rather than inlined as `runLocalEvalTurns: jest.fn()`) because MST wraps
// actions: the instance's `runLocalEvalTurns` property is not the same object as the jest.fn()
// used to define it (no `.mock` inspection API on the wrapped property), even though calls are
// still recorded on this original reference. Assertions below must use this spy, not
// `mockAssistantStore.runLocalEvalTurns`.
const runLocalEvalTurnsSpy = jest.fn();
// Same rationale as runLocalEvalTurnsSpy above: assert on this reference, not
// `mockAssistantStore.setEffort`. This is assistantStore.setEffort, distinct from appConfig's
// own setEffortSpy used elsewhere in this file.
const assistantSetEffortSpy = jest.fn();

const MockAssistantModel = types
  .model("MockAssistantModel", {
    llmId: types.string,
    llmList: types.optional(types.map(types.string), {}),
    thread: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel
  })
  .actions((self) => ({
    createThread: jest.fn(),
    deleteThread: jest.fn(),
    runLocalEvalTurns: runLocalEvalTurnsSpy,
    setEffort: assistantSetEffortSpy
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
    runLocalEvalTurnsSpy.mockClear();
    assistantSetEffortSpy.mockClear();
    mockConfig = {
      ...mockAppConfig,
      isDevMode: true,
      isLocalLlm: false,
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

  it("shows none/think effort options for a Local entry with effortLevels (DAVAI-126 thinking toggle)", () => {
    // The effort menu logic (findEntryByLlmId/resolveEffort) is already generic — this pins that
    // a Local llmList entry carrying effortLevels renders the same way any other model's does.
    // findEntryByLlmId looks the model up by id IN llmList (not off llmId's own JSON), so the
    // matching llmList entry must be present too — mirroring the Local WebGPU tests below.
    mockConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: ["none", "think"], defaultEffort: "none" },
    ];
    mockConfig.llmId = JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" });
    mockConfig.effort = "none";

    renderDeveloperOptions();

    const select = screen.getByTestId("effort-select");
    expect(select).toBeEnabled();
    const opts = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(opts).toEqual(["none", "think"]);
  });

  it("disables Local model options and annotates them when WebGPU is unavailable (DAVAI-126)", () => {
    mockIsWebGPUAvailable.mockReturnValue(false);
    mockConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];
    renderDeveloperOptions();
    const option = screen.getByRole("option", { name: /Qwen3-1\.7B.*requires WebGPU/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it("enables Local model options when WebGPU is available (DAVAI-126)", () => {
    mockIsWebGPUAvailable.mockReturnValue(true);
    mockConfig.llmList = [
      { id: "mock", provider: "Mock", effortLevels: [] },
      { id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local", effortLevels: [] },
    ];
    renderDeveloperOptions();
    const option = screen.getByRole("option", { name: "Local: Qwen3-1.7B-q4f16_1-MLC" }) as HTMLOptionElement;
    expect(option.disabled).toBe(false);
  });

  it("renders the Run Local Eval button (DAVAI-126 Task 11)", () => {
    renderDeveloperOptions();
    const button = screen.getByTestId("run-local-eval-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Run Local Eval");
  });

  it("aria-disables the Run Local Eval button when the selected LLM is not Local (DAVAI-126 Task 11)", () => {
    mockConfig.isLocalLlm = false;
    renderDeveloperOptions();
    expect(screen.getByTestId("run-local-eval-button")).toHaveAttribute("aria-disabled", "true");
  });

  it("enables (not aria-disabled) the Run Local Eval button when the selected LLM is Local (DAVAI-126 Task 11)", () => {
    mockConfig.isLocalLlm = true;
    renderDeveloperOptions();
    expect(screen.getByTestId("run-local-eval-button")).toHaveAttribute("aria-disabled", "false");
  });

  it("calls assistantStore.runLocalEvalTurns when clicked with a Local model selected (DAVAI-126 Task 11)", () => {
    mockConfig.isLocalLlm = true;
    renderDeveloperOptions();
    fireEvent.click(screen.getByTestId("run-local-eval-button"));
    expect(runLocalEvalTurnsSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call assistantStore.runLocalEvalTurns when clicked without a Local model selected (DAVAI-126 Task 11)", () => {
    mockConfig.isLocalLlm = false;
    renderDeveloperOptions();
    fireEvent.click(screen.getByTestId("run-local-eval-button"));
    expect(runLocalEvalTurnsSpy).not.toHaveBeenCalled();
  });

  it("syncs the Effort dropdown into the assistant store before running the eval " +
    "(DAVAI-126 eval round 2 item H — the eval must run against the effort the user actually " +
    "selected, not whatever a prior chat submit last set)", () => {
    mockConfig.isLocalLlm = true;
    mockConfig.effort = "think";
    renderDeveloperOptions();
    fireEvent.click(screen.getByTestId("run-local-eval-button"));
    expect(assistantSetEffortSpy).toHaveBeenCalledWith("think");
    // Order matters: effort must be synced before the eval reads self.effort.
    const effortCallOrder = assistantSetEffortSpy.mock.invocationCallOrder[0];
    const evalCallOrder = runLocalEvalTurnsSpy.mock.invocationCallOrder[0];
    expect(effortCallOrder).toBeLessThan(evalCallOrder);
  });

  it("does not sync effort or run the eval when clicked without a Local model selected " +
    "(DAVAI-126 eval round 2 item H)", () => {
    mockConfig.isLocalLlm = false;
    mockConfig.effort = "think";
    renderDeveloperOptions();
    fireEvent.click(screen.getByTestId("run-local-eval-button"));
    expect(assistantSetEffortSpy).not.toHaveBeenCalled();
    expect(runLocalEvalTurnsSpy).not.toHaveBeenCalled();
  });
});
