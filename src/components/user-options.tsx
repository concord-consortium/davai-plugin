import React from "react";
import { observer } from "mobx-react-lite";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";
import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModelType } from "../models/assistant-model";
import { AppConfigToggleOptions } from "../models/app-config-model";
import { useAppConfigContext } from "../contexts/app-config-context";

import "./user-options.scss";

interface IProps {
  assistantStore: AssistantModelType;
  onInitializeAssistant: () => void;
}

export const UserOptions: React.FC<IProps> = observer(function UserOptions({assistantStore, onInitializeAssistant}) {
  const appConfig = useAppConfigContext();

  const createToggleOption = (option: AppConfigToggleOptions, optionLabel: string) => {
    return (
      <div className="user-option">
        <label htmlFor={`${option}-toggle`} data-testid={`${option}-toggle-label`}>
          {optionLabel}:
        </label>
        <input
          data-testid={`${option}-toggle`}
          id={`${option}-toggle`}
          type="checkbox"
          role="switch"
          checked={!!appConfig[option]}
          aria-checked={!!appConfig[option]}
          onChange={() => appConfig.toggleOption(option)}
        />
      </div>
    );
  };

  return (
    <div className="user-options control-panel" role="group" aria-labelledby="control-panel-heading">
      <h2 id="control-panel-heading">Options</h2>
      <ReadAloudMenu createToggleOption={createToggleOption}/>
      <div className="control-panel-section" role="group" aria-labelledby="loading-indicators-heading">
        <h3 id="loading-indicators-heading">Loading Indicators</h3>
        {createToggleOption("playProcessingMessage", "Play loading message")}
        {createToggleOption("playProcessingTone", "Play loading tone")}
      </div>
      <KeyboardShortcutControls/>
      <DeveloperOptionsComponent
        assistantStore={assistantStore}
        createToggleOption={createToggleOption}
        onInitializeAssistant={onInitializeAssistant}
      />
    </div>
  );
});
