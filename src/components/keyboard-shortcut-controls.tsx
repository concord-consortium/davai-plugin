import React, { FormEvent, useState } from "react";
import { useOptions } from "../hooks/use-options";
import { ErrorMessage } from "./error-message";

import "./keyboard-shortcut-controls.scss";

export const KeyboardShortcutControls = () => {
  const { keyboardShortcutEnabled, keyboardShortcutKeys, toggleOption, updateOptions } = useOptions();
  const toggleButtonLabel = keyboardShortcutEnabled ? "Disable Shortcut" : "Enable Shortcut";
  const [showError, setShowError] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleToggleShortcut = () => {
    localStorage.setItem("keyboardShortcutEnabled", JSON.stringify(!keyboardShortcutEnabled));
    toggleOption("keyboardShortcutEnabled");
  };

  const handleCustomizeShortcut = (event: FormEvent) => {
    if (!keyboardShortcutEnabled) return;
    event.preventDefault();
    const form = event.target as HTMLInputElement;
    const shortcut = form.querySelector("input")?.value.trim();
    if (shortcut) {
      localStorage.setItem("keyboardShortcutKeys", shortcut);
      updateOptions?.({keyboardShortcutKeys: shortcut});
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
      className="options-section"
      role="group"
      aria-labelledby="keyboard-shortcuts-heading"
      data-testid="keyboard-shortcut-controls"
    >
      <div className="options-section-header">
        <h3 id="keyboard-shortcuts-heading">Keyboard Shortcuts</h3>
      </div>
      <div className="user-option">
        <button onClick={handleToggleShortcut} data-testid="keyboard-shortcut-toggle">
          {toggleButtonLabel}
        </button>
      </div>
      <form data-testid="custom-keyboard-shortcut-form" onSubmit={handleCustomizeShortcut}>
        <fieldset aria-disabled={!keyboardShortcutEnabled}>
          <label htmlFor="custom-keyboard-shortcut">Customize Shortcut:</label>
          <input
            aria-describedby={customShortcutInputDescribedBy}
            aria-invalid={showError}
            data-testid="custom-keyboard-shortcut"
            defaultValue={keyboardShortcutKeys}
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
              Keyboard shortcut changed to {keyboardShortcutKeys}
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
};
