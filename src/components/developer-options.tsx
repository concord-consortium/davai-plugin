import React from "react";
import { observer } from "mobx-react-lite";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { AssistantModelType } from "../models/assistant-model";
import { useAppConfigContext } from "../hooks/use-app-config-context";

import "./developer-options.scss";

interface IProps {
  assistantStore: AssistantModelType;
  onCreateThread: () => void;
  onDeleteThread: () => void;
  onMockAssistant: () => void;
}

export const DeveloperOptionsComponent = observer(function DeveloperOptions({assistantStore, onCreateThread, onDeleteThread, onMockAssistant}: IProps) {
  const appConfig = useAppConfigContext();

  const handleGetGraphData = async () => {
    const reqGetComponents = {
      action: "get",
      resource: "componentList",
      values: {
        request: {
          constraints: {
            orderBy: "id"
          }
        }
      }
    };
    const resGetComponents = await codapInterface.sendRequest(reqGetComponents) as any;

    const graphId = resGetComponents.values.find((item: any) => item.type === "graph").id;

    const reqGetGraph = {
      action: "get",
      resource: `component[${graphId}]`,
      values: {}
    };
    const resGetGraph = await codapInterface.sendRequest(reqGetGraph) as any;
    console.log("Graph Data:", resGetGraph.values);

    const devOptionsContainer = document.querySelector(".developer-options");
    if (devOptionsContainer) {
      const img = document.createElement("img");
      img.src = resGetGraph.values.exportDataUri;
      devOptionsContainer.appendChild(img);
    }
  };

  return (
    <div className="developer-options" data-testid="developer-options">
      <label htmlFor="mock-assistant-checkbox" data-testid="mock-assistant-checkbox-label">
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
        disabled={!assistantStore.thread}
        onClick={onDeleteThread}
      >
        Delete Thread
      </button>
      <button
        data-testid="new-thread-button"
        disabled={assistantStore.thread || appConfig.isAssistantMocked}
        onClick={onCreateThread}
      >
        New Thread
      </button>
      <button onClick={handleGetGraphData}>Get Graph Data</button>
    </div>
  );
});
