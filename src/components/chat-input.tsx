import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isInputElement, isShortcutPressed } from "../utils/utils";

import "./chat-input.scss";

interface IProps {
  disabled?: boolean;
  keyboardShortcutEnabled: boolean;
  shortcutKeys: string;
  onKeyboardShortcut: () => void;
  onSubmit: (messageText: string) => void;
}

export const ChatInputComponent = ({disabled, keyboardShortcutEnabled, shortcutKeys, onKeyboardShortcut, onSubmit}: IProps) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  // const [browserSupportsDictation, setBrowserSupportsDictation] = useState(false);
  // const [dictationEnabled, setDictationEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showError, setShowError] = useState(false);

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    // setDictationEnabled(false);

    if (!inputValue || inputValue.trim() === "") {
      setShowError(true);
      textAreaRef.current?.focus();
    } else {
      onSubmit(inputValue);
      setInputValue("");
      textAreaRef.current?.focus();
      setShowError(false);
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      textAreaRef.current?.blur();
      handleSubmit();
    }
  };

  // The code in this useEffect is all related to the dictation feature which isn't implemented yet.
  // useEffect(() => {
  //   if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return;

  //   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  //   if (SpeechRecognition) {
  //     setBrowserSupportsDictation(true);
  //   }

  //   const recognition = new SpeechRecognition();
  //   recognition.continuous = true;
  //   recognition.interimResults = false;

  //   recognition.onresult = (event: SpeechRecognitionEvent) => {
  //     const speechToText = Array.from(event.results).map(result => result[0].transcript).join("");
  //     setInputValue(speechToText);
  //   };

  //   recognition.onerror = (event) => {
  //     console.error("Speech recognition error detected:", event.error);
  //   };

  //   recognition.onaudiostart = () => {
  //     // We may want the UI respond somehow when audio capture begins.
  //     console.log("Microphone capturing audio.");
  //   };

  //   if (dictationEnabled) {
  //     try {
  //       recognition.start();
  //     } catch (error) {
  //       console.error("Error starting recognition:", error);
  //     }
  //   } else {
  //     recognition.stop();
  //   }

  //   return () => recognition.stop();
  // }, [browserSupportsDictation, dictationEnabled]);

  // const handleDictateToggle = () => {
  //   if (dictationEnabled) {
  //     handleSubmit();
  //   }
  //   setDictationEnabled(!dictationEnabled);
  // };

  const pressedKeys: Set<string> = useMemo(() => new Set(), []);

  const addShortcutListener = useCallback((context: Window) => {
    const keydownHandler = (event: KeyboardEvent) => {
      pressedKeys.add(event.code);
      if (isShortcutPressed(pressedKeys, shortcutKeys)) {
        event.preventDefault();
        const activeElement = context.document.activeElement;
        if (isInputElement(activeElement)) return;

        if (window.frameElement) {
          textAreaRef.current?.focus();
          onKeyboardShortcut();
        } else {
          textAreaRef.current?.focus();
          onKeyboardShortcut();
        }
      }
    };

    const keyupHandler = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code);
    };

    context.document.addEventListener("keydown", keydownHandler);
    context.document.addEventListener("keyup", keyupHandler);

    // Return handler for cleanup
    return () => {
      context.document.removeEventListener("keydown", keydownHandler);
      context.document.removeEventListener("keyup", keyupHandler);
    };
  }, [onKeyboardShortcut, pressedKeys, shortcutKeys]);

  useEffect(() => {
    const keydownListeners: (() => void)[] = [];

    if (keyboardShortcutEnabled) {
      // Add keyboard shortcut listener to the parent window if one exists.
      if (window.parent && window.parent !== window) {
        keydownListeners.push(addShortcutListener(window.parent));
      }

      // Add keyboard shortcut listener to the current window.
      keydownListeners.push(addShortcutListener(window));
    }

    return () => {
      keydownListeners.forEach((cleanup) => cleanup());
    };
  }, [addShortcutListener, keyboardShortcutEnabled]);

  // Place focus on the textarea when the component mounts.
  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  return (
    <div className="chat-input" data-testid="chat-input">
      <form onSubmit={handleSubmit}>
        <fieldset>
          <label className="visually-hidden" data-testid="chat-input-label" htmlFor="chat-input">
            Chat Input
          </label>
          <textarea
            aria-describedby={showError ? "input-error" : undefined}
            aria-invalid={showError}
            data-testid="chat-input-textarea"
            disabled={disabled}
            id="chat-input"
            placeholder={"Ask DAVAI about the data"}
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyUp={handleKeyUp}
          />
          {showError &&
            <div
              aria-live="assertive"
              className="error-message"
              data-testid="input-error"
              id="input-error"
              role="alert"
            >
              Please enter a message before sending.
            </div>
          }
          <div className="buttons-container">
            <button
              className="send"
              data-testid="chat-input-send"
              disabled={disabled}
              type="submit"
            >
              Send
            </button>
            {/* {browserSupportsDictation && 
              <button
                aria-pressed={dictationEnabled}
                className="dictate"
                type="button"
                onClick={handleDictateToggle}
              >
                Dictate
              </button>
            } */}
          </div>
        </fieldset>
      </form>
    </div>
  );
};
