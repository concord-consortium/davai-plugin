import React, { useEffect, useState } from "react";
import { OpenAI } from "openai";
import { observer } from "mobx-react-lite";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useOpenAIContext } from "../hooks/use-openai-context";

import "./developer-options.scss";

interface IProps {
  assistantStore: AssistantModelType;
  onCreateThread: () => void;
  onDeleteThread: () => void;
  onSelectAssistant: (id: string) => void;
}

export const DeveloperOptionsComponent = observer(function DeveloperOptions({assistantStore, onCreateThread, onDeleteThread, onSelectAssistant}: IProps) {
  const appConfig = useAppConfigContext();
  const apiConnection = useOpenAIContext();
  const selectedAssistant = assistantStore.assistantId ? assistantStore.assistantId : "mock";
  const [assistantOptions, setAssistantOptions] = useState<Map<string, string>>();

  useEffect(() => {
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
  }, [apiConnection.beta.assistants]);

  const handleSetSelectedAssistant = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    onSelectAssistant(id);
  };

  return (
    <div className="developer-options" data-testid="developer-options">
      <label htmlFor="assistant-select" data-testid="assistant-select-label">
        Select an Assistant
      </label>
      <select
        id="assistant-select"
        data-testid="assistant-select"
        value={selectedAssistant}
        onChange={handleSetSelectedAssistant}
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
      <button
        data-testid="delete-thread-button"
        disabled={!assistantStore.assistant || !assistantStore.thread}
        onClick={onDeleteThread}
      >
        Delete Thread
      </button>
      <button
        data-testid="new-thread-button"
        disabled={!assistantStore.assistant || assistantStore.thread || appConfig.isAssistantMocked}
        onClick={onCreateThread}
      >
        New Thread
      </button>
    </div>
  );
});
