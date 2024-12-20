import React, { SyntheticEvent, useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../hooks/use-app-config-context";

import "./developer-options.scss";
import { useOpenAIContext } from "../hooks/use-open-ai-context";

interface IProps {
  assistantStore: AssistantModelType;
  onCreateThread: () => void;
  onDeleteThread: () => void;
  onMockAssistant: () => void;
}

export const DeveloperOptionsComponent = observer(function DeveloperOptions({assistantStore, onCreateThread, onDeleteThread, onMockAssistant}: IProps) {
  const appConfig = useAppConfigContext();
  const apiConnection = useOpenAIContext();
  const [assistantOptions, setAssistantOptioms] = useState<string[]>();

  useEffect(() => {
    const fetchAssistants = async () => {
     try {
      const res = await apiConnection.beta.assistants.list();
      const assistantIds = res.data.map(asst => asst.id);
      setAssistantOptioms(assistantIds);
     } catch (err) {
      console.error(err);
     }
    };

    fetchAssistants();
  }, [apiConnection.beta.assistants]);

  const handleSetSelectedAssistant = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    assistantStore.initializeAssistant(id);
  };

  return (
    <div className="developer-options" data-testid="developer-options">
      <label htmlFor="mock-assistant-checkbox" data-testid="mock-assistant-checkbox-label">
        <select
          value={assistantStore.assistantId ? assistantStore.assistantId : "default"}
          onChange={handleSetSelectedAssistant}
        >
          <option value="default" disabled>
            -- Select an assistant --
          </option>
          {assistantOptions?.map((id) => {
            return (
              <option aria-selected={assistantStore.assistantId === id} key={id}>
                {id}
              </option>
            );
          })}
        </select>
        <input
          checked={appConfig.isAssistantMocked}
          data-testid="mock-assistant-checkbox"
          id="mock-assistant-checkbox"
          type="checkbox"
          onChange={onMockAssistant}
        />
        Use Mock Assistant
      </label>
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
