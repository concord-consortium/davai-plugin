import React, { FormEvent, useState } from "react";
import { observer } from "mobx-react-lite";
import { ErrorMessage } from "./error-message";
import { useAppConfigContext } from "../contexts/app-config-context";
import { AppConfigKeyboardShortcutKeys } from "../models/app-config-model";

import "./keyboard-shortcut-controls.scss";

const KEYBOARD_SHORTCUT_OPTIONS: { key: AppConfigKeyboardShortcutKeys; description: string }[] = [
  { key: "focusChatInput", description: "Focus the chat input" },
  { key: "replayLastDavaiMessage", description: "Replay the last DAVAI message" },
  { key: "sonifyGraph", description: "Play the graph sonification" },
  { key: "captureTranscript", description: "Capture the chat transcript" },
];

export const KeyboardShortcutControls = observer(function KeyboardShortcutControls() {
  const appConfig = useAppConfigContext();
  const { keyboardShortcutsEnabled, keyboardShortcuts } = appConfig;
  const toggleButtonLabel = keyboardShortcutsEnabled ? "Disable Shortcut" : "Enable Shortcut";
  const [confirmedKey, setConfirmedKey] = useState<AppConfigKeyboardShortcutKeys | null>(null);
  const [erroredKey, setErroredKey] = useState<AppConfigKeyboardShortcutKeys | null>(null);

  const handleToggleShortcut = () => {
    appConfig.toggleOption("keyboardShortcutsEnabled");
  };

  const handleCustomizeShortcut = (shortcutKey: AppConfigKeyboardShortcutKeys) => (event: FormEvent) => {
    if (!keyboardShortcutsEnabled) return;
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const shortcut = form.querySelector("input")?.value.trim();
    if (shortcut) {
      appConfig.update(() => {
        appConfig.keyboardShortcuts[shortcutKey] = shortcut;
      });
      setErroredKey(null);
      setConfirmedKey(shortcutKey);
    } else {
      setConfirmedKey(null);
      setErroredKey(shortcutKey);
    }
  };

  return (
    <div
      className="control-panel-section"
      role="group"
      aria-labelledby="keyboard-shortcuts-heading"
      data-testid="keyboard-shortcut-controls"
    >
      <h3 id="keyboard-shortcuts-heading">Keyboard Shortcuts</h3>
      <div className="options-list-1">
        <div className="user-option">
          <button onClick={handleToggleShortcut} data-testid="keyboard-shortcut-toggle">
            {toggleButtonLabel}
          </button>
        </div>
        {KEYBOARD_SHORTCUT_OPTIONS.map(({ key, description }) => {
          const inputId = `custom-keyboard-shortcut-${key}`;
          const confirmationId = `${inputId}-confirmation`;
          const showConfirmation = confirmedKey === key;
          const showError = erroredKey === key;
          const describedBy = showConfirmation
            ? confirmationId
            : showError
              ? `${inputId}-error`
              : undefined;
          return (
            <form
              key={key}
              data-testid={`${inputId}-form`}
              onSubmit={handleCustomizeShortcut(key)}
            >
              <fieldset aria-disabled={!keyboardShortcutsEnabled}>
                <label htmlFor={inputId}>{description}:</label>
                <input
                  aria-describedby={describedBy}
                  aria-invalid={showError}
                  data-testid={inputId}
                  defaultValue={keyboardShortcuts[key]}
                  id={inputId}
                  type="text"
                />
                <button data-testid={`${inputId}-submit`} type="submit">Customize</button>
                {showConfirmation &&
                  <div
                    aria-live="polite"
                    className="confirmation-message"
                    data-testid={confirmationId}
                    id={confirmationId}
                    role="status"
                  >
                    {description} shortcut changed to {keyboardShortcuts[key]}
                    <button
                      className="dismiss"
                      data-testid={`${confirmationId}-dismiss`}
                      onClick={() => setConfirmedKey(null)}>
                        <span className="visually-hidden">Dismiss this message.</span>
                    </button>
                  </div>
                }
                { showError && <ErrorMessage slug={inputId} message="Please enter a value for the keyboard shortcut." /> }
              </fieldset>
            </form>
          );
        })}
      </div>
    </div>
  );
});
