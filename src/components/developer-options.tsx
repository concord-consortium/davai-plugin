import React from "react";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { getUrlParam } from "../utils/utils";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { IUserOptions } from "../types";
import { observer } from "mobx-react-lite";

interface IProps {
  createToggleOption: (option: keyof IUserOptions, optionLabel: string) => React.JSX.Element;
  assistantStore: AssistantModelType;
}

export const DeveloperOptionsComponent = observer(({assistantStore, createToggleOption}: IProps) => {
  const appConfig = useAppConfigContext();
  const selectedLlm = appConfig.llmId;
  const isDevMode = getUrlParam("mode") === "development" || appConfig.mode === "development";

  const handleCreateThread = async () => {
    // if (assistantStore.thread || appConfig.isAssistantMocked) return;
    // const confirmCreate = window.confirm("Are you sure you want to create a new thread? If you do, you will lose any existing chat history.");
    // if (!confirmCreate) return;

    // assistantStore.transcriptStore.clearTranscript();
    // assistantStore.transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});

    // await assistantStore.createThread();
  };

  const handleDeleteThread = async () => {
    if (!assistantStore.threadId) return;
    const confirmDelete = window.confirm("Are you sure you want to delete the current thread? If you do, you will not be able to continue this chat.");
    if (!confirmDelete) return false;

    // await assistantStore.deleteThread();
    return true;
  };

  const handleSelectLlm = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    // If we switch LLMs, we delete the current thread and clear the transcript.
    // First make sure the user is OK with that.
    const llm = e.target.value;
    const llmObj = JSON.parse(llm);

    const threadDeleted = await handleDeleteThread();
    if (!threadDeleted) return;


    // todo: move stringified llmIds to constants
    if (llmObj.id === "mock") {
      assistantStore.transcriptStore.clearTranscript();
      assistantStore.transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});
    }

    appConfig.setLlmId(llm);
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
          data-testid="delete-thread-button"
          aria-disabled={!assistantStore.threadId}
          onClick={handleDeleteThread}
        >
          Delete Thread
        </button>
      </div>
      <div className="user-option">
        <button
          data-testid="new-thread-button"
          aria-disabled={!!assistantStore.threadId || appConfig.isAssistantMocked}
          onClick={handleCreateThread}
        >
          New Thread
        </button>
      </div>
    </div>
  );
});
