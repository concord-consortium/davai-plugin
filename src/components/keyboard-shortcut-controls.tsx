import React, { FormEvent, useState } from "react";

import "./keyboard-shortcut-controls.scss";

interface IProps {
  shortcutEnabled: boolean;
  shortcutKeys?: string;
  onCustomizeShortcut?: (shortcut: string) => void;
  onToggleShortcut: () => void;
}

export const KeyboardShortcutControls = (props: IProps) => {
  const { shortcutEnabled, shortcutKeys, onCustomizeShortcut, onToggleShortcut } = props;
  const toggleButtonLabel = shortcutEnabled ? "Disable Shortcut" : "Enable Shortcut";
  const [showError, setShowError] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleToggleShortcut = () => {
    onToggleShortcut();
  };

  const handleCustomizeShortcut = (event: FormEvent) => {
    event.preventDefault();
    const form = event.target as HTMLInputElement;
    const shortcut = form.querySelector("input")?.value;
    if (shortcut) {
      onCustomizeShortcut?.(shortcut);
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
    <div className="keyboard-shortcut-controls">
      <h3>Keyboard Shortcut</h3>
      <button onClick={handleToggleShortcut} data-testid="keyboard-shortcut-toggle">
        {toggleButtonLabel}
      </button>
      <form data-testid="custom-keyboard-shortcut-form" onSubmit={handleCustomizeShortcut}>
        <fieldset disabled={!shortcutEnabled}>
          <label htmlFor="custom-keyboard-shortcut">Customize Keystroke</label>
          <input
            aria-describedby={customShortcutInputDescribedBy}
            aria-invalid={showError}
            data-testid="custom-keyboard-shortcut"
            defaultValue={shortcutKeys}
            id="custom-keyboard-shortcut"
            type="text"
          />
          <button data-testid="custom-keyboard-shortcut-submit" type="submit">Customize</button>
          {showConfirmation &&
            <div
              aria-live="assertive"
              className="confirmation-message"
              data-testid="custom-keyboard-shortcut-confirmation"
              id="custom-keyboard-shortcut-confirmation"
              role="alert"
            >
              Keyboard shortcut changed to {shortcutKeys}
              <button
                aria-label="Dismiss this message." 
                className="dismiss"
                data-testid="custom-keyboard-shortcut-confirmation-dismiss"
                onClick={() => setShowConfirmation(false)}>
                  X
              </button>
            </div>
          }
          {showError &&
            <div
              aria-live="assertive"
              className="error-message"
              data-testid="custom-keyboard-shortcut-error"
              id="custom-keyboard-shortcut-error"
              role="alert"
            >
              Please enter a value for the keyboard shortcut.
            </div>
          }
        </fieldset>
      </form>
    </div>
  );
};
