import React from "react";
import { observer } from "mobx-react-lite";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../contexts/app-config-context";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { AppConfigToggleOptions } from "../models/app-config-model";

interface IProps {
  assistantStore: AssistantModelType;
  createToggleOption: (option: AppConfigToggleOptions, optionLabel: string) => React.JSX.Element;
  onInitializeAssistant: () => void;
}

export const DeveloperOptionsComponent = observer(({assistantStore, createToggleOption, onInitializeAssistant}: IProps) => {
  const appConfig = useAppConfigContext();
  const selectedLlm = appConfig.llmId;
  const { isDevMode } = appConfig;

  const confirmNewThread = () => {
    if (!assistantStore.threadId) {
      // We don't need to confirm if there's no existing thread
      return true;
    }
    return window.confirm("Are you sure you want to create a new thread? If you do, you will lose any existing chat history.");
  };

  const resetTranscriptStore = () => {
    assistantStore.transcriptStore.clearTranscript();
    assistantStore.transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});
  };

  const handleCreateThread = (skipConfirmation = false) => {
    if (!skipConfirmation) {
      if(!confirmNewThread()) return;
    }

    resetTranscriptStore();
    // We need to manually initialize the assistant again since we are reusing the same assistant store
    onInitializeAssistant();
  };

  const handleSelectLlm = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // If we switch LLMs, we are going to create a new thread and clear the transcript.
    // First make sure the user is OK with that.
    const newThreadConfirmed = confirmNewThread();
    if (!newThreadConfirmed) return;

    resetTranscriptStore();
    appConfig.setLlmId(e.target.value);
    // We don't need to initialize the assistant here, because changing the LLM ID
    // will automatically re-initialize it via an effect in the App component
  };

  return (
    !isDevMode ? <div/> :
    <div className="control-panel-section" role="group" aria-labelledby="dev-options-heading" data-testid="developer-options">
      <h3 id="dev-options-heading">Developer Options</h3>
      {createToggleOption("showDebugLogInDevMode", "Show Debug Log")}
      <div className="user-option">
        <label htmlFor="llm-select" data-testid="llm-select-label">
          Select an LLM:
        </label>
        <select
          id="llm-select"
          data-testid="llm-select"
          value={selectedLlm}
          onChange={handleSelectLlm}
        >
          {appConfig.llmList.map((llm) => (
            <option
              aria-selected={appConfig.llmId === JSON.stringify(llm)}
              key={llm.id}
              value={JSON.stringify(llm)}
            >
              {llm.id === "mock" ? "Mock LLM" : `${llm.provider}: ${llm.id}`}
            </option>
          ))}
        </select>
      </div>
      <div className="user-option">
        <button
          data-testid="new-thread-button"
          aria-disabled={!!assistantStore.threadId || appConfig.isAssistantMocked}
          onClick={() => handleCreateThread()}
        >
          New Thread
        </button>
      </div>
    </div>
  );
});
