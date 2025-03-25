import React, { useEffect, useState } from "react";
import { OpenAI } from "openai";
import { observer } from "mobx-react-lite";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useOpenAIContext } from "../hooks/use-openai-context";
import { getUrlParam } from "../utils/utils";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { IUserOptions } from "../types";

interface IProps {
  createToggleOption: (option: keyof IUserOptions, optionLabel: string) => React.JSX.Element;
  assistantStore: AssistantModelType;
}

export const DeveloperOptionsComponent = observer(function DeveloperOptions({assistantStore, createToggleOption}: IProps) {
  const appConfig = useAppConfigContext();
  const apiConnection = useOpenAIContext();
  const selectedAssistant = assistantStore.assistantId ? assistantStore.assistantId : "mock";
  const [assistantOptions, setAssistantOptions] = useState<Map<string, string>>();
  const isDevMode = getUrlParam("mode") === "development" || appConfig.mode === "development";

  useEffect(() => {
    if (!isDevMode) return;
    const fetchAssistants = async () => {
      try {
        const res = await apiConnection.beta.assistants.list();
        const assistants = new Map();
        res.data.map((assistant: OpenAI.Beta.Assistant) => {
          const assistantName = assistant.name || assistant.id;
          assistants.set(assistant.id, assistantName);
        });
        setAssistantOptions(assistants);
      } catch (err) {
        console.error(err);
      }
    };

    fetchAssistants();
  }, [apiConnection.beta.assistants, isDevMode]);

  const handleCreateThread = async () => {
    if (!assistantStore.assistant || assistantStore.thread || appConfig.isAssistantMocked) return;
    const confirmCreate = window.confirm("Are you sure you want to create a new thread? If you do, you will lose any existing chat history.");
    if (!confirmCreate) return;

    assistantStore.transcriptStore.clearTranscript();
    assistantStore.transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});

    await assistantStore.createThread();
  };

  const handleDeleteThread = async () => {
    if (!assistantStore.assistant || !assistantStore.thread) return;
    const confirmDelete = window.confirm("Are you sure you want to delete the current thread? If you do, you will not be able to continue this chat.");
    if (!confirmDelete) return false;

    await assistantStore.deleteThread();
    return true;
  };

  const handleSelectAssistant = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    // If we switch assistants, we delete the current thread and clear the transcript.
    // First make sure the user is OK with that.
    const id = e.target.value;

    const threadDeleted = await handleDeleteThread();
    if (!threadDeleted) return;

    if (id === "mock") {
      assistantStore.transcriptStore.clearTranscript();
      assistantStore.transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});
      appConfig.setMockAssistant(true);
      appConfig.setAssistantId(id);
      return;
    }

    appConfig.setMockAssistant(false);
    appConfig.setAssistantId(id);
  };

  return (
    !isDevMode ? <div/> :
    <div className="options-section">
      <div className="options-section-header">
        <h3>Developer Options</h3>
      </div>
      {createToggleOption("showDebugLog", "Show Debug Log")}
      <div className="user-option">
        <label htmlFor="assistant-select" data-testid="assistant-select-label">
          Select an Assistant:
        </label>
        <select
          id="assistant-select"
          data-testid="assistant-select"
          value={selectedAssistant}
          onChange={handleSelectAssistant}
        >
          <option value="mock">Mock Assistant</option>
          {Array.from(assistantOptions?.entries() || []).map(([assistantId, assistantName]) => (
            <option
              aria-selected={assistantStore.assistantId === assistantId}
              key={assistantId}
              value={assistantId}
            >
              {assistantName}
            </option>
          ))}
        </select>
      </div>
      <div className="user-option">
        <button
          data-testid="delete-thread-button"
          aria-disabled={!assistantStore.assistant || !assistantStore.thread}
          onClick={handleDeleteThread}
        >
          Delete Thread
        </button>
      </div>
      <div className="user-option">
        <button
          data-testid="new-thread-button"
          aria-disabled={!assistantStore.assistant || !!assistantStore.thread || appConfig.isAssistantMocked}
          onClick={handleCreateThread}
        >
          New Thread
        </button>
      </div>
    </div>
  );
});
