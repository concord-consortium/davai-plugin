import React from "react";
import { useOptions } from "../contexts/user-options-context";
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
        <label htmlFor="readaloud-toggle" data-testid="toggle-label">
          {optionLabel}:
        </label>
        <input
          data-testid="readaloud-toggle"
          id="readaloud-toggle"
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
    <div className="user-options">
      <div className="options-header">
        <h2>Options</h2>
      </div>
      <ReadAloudMenu/>
      <div className="options-section">
        <div className="options-section-header">
          <h3>Loading Indicators</h3>
        </div>
        {createToggleOption("playProcessingMessage", "Play loading message")}
        {createToggleOption("playProcessingTone", "Play loading tone")}
      </div>
      <KeyboardShortcutControls/>
      <DeveloperOptionsComponent assistantStore={assistantStore}/>
    </div>
  );
};
