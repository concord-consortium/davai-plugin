import React, { FormEvent, useState } from "react";

import "./keyboard-shortcut-controls.scss";

interface IProps {
  shortcutEnabled: boolean;
  shortcutKeys: string;
  onCustomizeShortcut?: (shortcut: string) => void;
  onToggleShortcut: () => void;
}

export const KeyboardShortcutControls = (props: IProps) => {
  const { shortcutEnabled, shortcutKeys, onCustomizeShortcut, onToggleShortcut } = props;
  const toggleButtonLabel = shortcutEnabled ? "Disable Keyboard Shortcut" : "Enable Keyboard Shortcut";
  const [showError, setShowError] = useState(false);

  const handleToggleShortcut = () => {
    onToggleShortcut();
  };

  const handleCustomizeShortcut = (event: FormEvent) => {
    event.preventDefault();
    const form = event.target as HTMLInputElement;
    // get the text value from the form's input element
    const shortcut = form.querySelector("input")?.value;
    console.log("Customizing shortcut to", shortcut);
    if (shortcut) {
      onCustomizeShortcut?.(shortcut);
      setShowError(false);
    } else {
      setShowError(true);
    }
  };

  return (
    <div className="keyboard-shortcut-controls">
      <h3>Keyboard Shortcut</h3>
      <button onClick={handleToggleShortcut}>
        {toggleButtonLabel}
      </button>
      <form onSubmit={handleCustomizeShortcut}>
        <fieldset disabled={!shortcutEnabled}>
          <label htmlFor="custom-keyboard-shortcut">Customize Keyboard Shortcut</label>
          <input
            aria-describedby={showError ? "input-error" : undefined}
            aria-invalid={showError}
            defaultValue={shortcutKeys}
            id="custom-keyboard-shortcut"
            type="text"
          />
          <button type="submit">Customize</button>
          {showError &&
            <div
              aria-live="assertive"
              className="error-message"
              data-testid="input-error"
              id="input-error"
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
