import React from "react";
import { useOptions } from "../hooks/use-options";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";
import { IUserOptions } from "../types";
import { DeveloperOptionsComponent } from "./developer-options";
import { AssistantModelType } from "../models/assistant-model";

import "./user-options.scss";

interface IProps {
  assistantStore: AssistantModelType;
}

export const UserOptions: React.FC<IProps> = ({assistantStore}) => {
  const { options, toggleOption } = useOptions();

  const createToggleOption = (option: keyof IUserOptions, optionLabel: string) => {
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
          checked={!!options[option]}
          aria-checked={!!options[option]}
          onChange={() => toggleOption(option)}
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
      <DeveloperOptionsComponent createToggleOption={createToggleOption} assistantStore={assistantStore}/>
    </div>
  );
};
