import React, { FormEvent, useState } from "react";
import { observer } from "mobx-react-lite";
import { ErrorMessage } from "./error-message";
import { useAppConfigContext } from "../contexts/app-config-context";

import "./keyboard-shortcut-controls.scss";

export const KeyboardShortcutControls = observer(function KeyboardShortcutControls() {
  const appConfig = useAppConfigContext();
  const { keyboardShortcutsEnabled, keyboardShortcuts: { focusChatInput } } = appConfig;
  const toggleButtonLabel = keyboardShortcutsEnabled ? "Disable Shortcut" : "Enable Shortcut";
  const [showError, setShowError] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleToggleShortcut = () => {
    appConfig.toggleOption("keyboardShortcutsEnabled");
  };

  const handleCustomizeShortcut = (event: FormEvent) => {
    if (!keyboardShortcutsEnabled) return;
    event.preventDefault();
    const form = event.target as HTMLInputElement;
    const shortcut = form.querySelector("input")?.value.trim();
    if (shortcut) {
      appConfig.update(() => {
        appConfig.keyboardShortcuts.focusChatInput = shortcut;
      });
      setShowError(false);
      setShowConfirmation(true);
    } else {
      setShowError(true);
      setShowConfirmation(false);
    }
  };

  const customShortcutInputDescribedBy = showConfirmation
    ? "custom-keyboard-shortcut-confirmation"
    : showError
      ? "custom-keyboard-shortcut-error"
      : undefined;

  return (
    <div
      className="control-panel-section"
      role="group"
      aria-labelledby="keyboard-shortcuts-heading"
      data-testid="keyboard-shortcut-controls"
    >
      <h3 id="keyboard-shortcuts-heading">Keyboard Shortcuts</h3>
      <div className="user-option">
        <button onClick={handleToggleShortcut} data-testid="keyboard-shortcut-toggle">
          {toggleButtonLabel}
        </button>
      </div>
      <form data-testid="custom-keyboard-shortcut-form" onSubmit={handleCustomizeShortcut}>
        <fieldset aria-disabled={!keyboardShortcutsEnabled}>
          <label htmlFor="custom-keyboard-shortcut">Customize Shortcut:</label>
          <input
            aria-describedby={customShortcutInputDescribedBy}
            aria-invalid={showError}
            data-testid="custom-keyboard-shortcut"
            defaultValue={focusChatInput}
            id="custom-keyboard-shortcut"
            type="text"
          />
          <button data-testid="custom-keyboard-shortcut-submit" type="submit">Customize</button>
          {showConfirmation &&
            <div
              aria-live="polite"
              className="confirmation-message"
              data-testid="custom-keyboard-shortcut-confirmation"
              id="custom-keyboard-shortcut-confirmation"
              role="status"
            >
              Keyboard shortcut changed to {focusChatInput}
              <button
                className="dismiss"
                data-testid="custom-keyboard-shortcut-confirmation-dismiss"
                onClick={() => setShowConfirmation(false)}>
                  <span className="visually-hidden">Dismiss this message.</span>
              </button>
            </div>
          }
          { showError && <ErrorMessage slug="custom-keyboard-shortcut" message="Please enter a value for the keyboard shortcut." /> }
        </fieldset>
      </form>
    </div>
  );
});
