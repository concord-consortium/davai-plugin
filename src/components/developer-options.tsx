import React from "react";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfig } from "../hooks/use-app-config-context";
import { getUrlParam } from "../utils/utils";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { IUserOptions } from "../types";
import { observer } from "mobx-react-lite";

interface IProps {
  assistantStore: AssistantModelType;
  createToggleOption: (option: keyof IUserOptions, optionLabel: string) => React.JSX.Element;
  onInitializeAssistant: () => void;
}

export const DeveloperOptionsComponent = observer(({assistantStore, createToggleOption, onInitializeAssistant}: IProps) => {
  const { appConfig, isAssistantMocked, llmId, llmList, setLlmId } = useAppConfig();
  const selectedLlm = appConfig.llmId;
  const isDevMode = getUrlParam("mode") === "development" || appConfig.mode === "development";

  const handleCreateThread = async () => {
    if (!assistantStore.threadId || isAssistantMocked) return;
    const confirmCreate = window.confirm("Are you sure you want to create a new thread? If you do, you will lose any existing chat history.");
    if (!confirmCreate) return false;

    assistantStore.transcriptStore.clearTranscript();
    assistantStore.transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});
    onInitializeAssistant();
    return true;
  };

  const handleSelectLlm = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    // If we switch LLMs, we create a new thread and clear the transcript.
    // First make sure the user is OK with that.
    const llm = e.target.value;
    const newThreadConfirmed = await handleCreateThread();
    if (!newThreadConfirmed) return;

    setLlmId(llm);
  };

  return (
    !isDevMode ? <div/> :
    <div className="control-panel-section" role="group" aria-labelledby="dev-options-heading" data-testid="developer-options">
      <h3 id="dev-options-heading">Developer Options</h3>
      {createToggleOption("showDebugLog", "Show Debug Log")}
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
          {llmList.map((llm: any) => (
            <option
              aria-selected={llmId === JSON.stringify(llm)}
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
          aria-disabled={!!assistantStore.threadId || isAssistantMocked}
          onClick={handleCreateThread}
        >
          New Thread
        </button>
      </div>
    </div>
  );
});
